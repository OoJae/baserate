// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title MusdDispenser
/// @notice Testnet-only MUSD faucet. Judges top up the interest and fee they owe before `repayAndWithdraw`.
/// @dev Two modes, switched by the owner through `setSigner`:
/// - Open mode (`signer == address(0)`, the initial state): anyone may claim; `deadline` and `sig` are ignored.
///   Free Sybil addresses are bounded by `globalDaily`.
/// - Voucher mode (`signer != address(0)`): each claim carries an EIP-712
///   `Claim(address to,uint256 amount,uint256 deadline)` signed by `signer`, with `to == msg.sender`. There is no
///   nonce: a voucher stays usable until its deadline, but every use counts against the per-address and global daily
///   limits, so replay is bounded by the on-chain caps. The signer key holds no funds.
/// Claims always pay `msg.sender`. A day is `block.timestamp / 1 days` (UTC midnight rollover). No precompile calls.
/// Never deploy on mainnet: in open mode the daily limits are the only Sybil defence.
contract MusdDispenser is Ownable2Step, EIP712, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @notice EIP-712 typehash of a claim voucher.
    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(address to,uint256 amount,uint256 deadline)");

    /// @notice The dispensed token (MUSD).
    IERC20 public immutable TOKEN;

    /// @notice Maximum amount one address may claim per day.
    uint256 public perAddressDaily;
    /// @notice Maximum amount all addresses together may claim per day.
    uint256 public globalDaily;
    /// @notice Voucher signer; `address(0)` means open mode.
    address public signer;
    /// @notice When true, `claim` reverts. Owner functions stay available.
    bool public paused;

    /// @notice Amount claimed by `account` on `day`.
    mapping(uint256 day => mapping(address account => uint256 amount)) public claimedBy;
    /// @notice Amount claimed by everyone on `day`.
    mapping(uint256 day => uint256 amount) public claimedTotal;

    event Claimed(address indexed to, uint256 amount, uint256 indexed day);
    event LimitsSet(uint256 perAddressDaily, uint256 globalDaily);
    event SignerSet(address indexed signer);
    event PausedSet(bool paused);
    event Swept(address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error DispenserPaused();
    error SignatureExpired(uint256 deadline);
    error InvalidSignature();
    error AddressLimitExceeded(uint256 amount, uint256 remaining);
    error GlobalLimitExceeded(uint256 amount, uint256 remaining);
    error InsufficientBalance(uint256 amount, uint256 balance);
    error RenounceDisabled();

    /// @param owner_ Admin (passed explicitly: under the CREATE2 deployer `msg.sender` is the deployer contract).
    /// @param token The dispensed token (testnet MUSD).
    /// @param perAddressDaily_ Initial per-address daily limit.
    /// @param globalDaily_ Initial global daily limit.
    /// @dev Starts in open mode (`signer == address(0)`) and unpaused.
    constructor(address owner_, address token, uint256 perAddressDaily_, uint256 globalDaily_)
        Ownable(owner_)
        EIP712("Baserate MUSD Dispenser", "1")
    {
        if (token == address(0)) revert ZeroAddress();
        TOKEN = IERC20(token);
        perAddressDaily = perAddressDaily_;
        globalDaily = globalDaily_;
        emit LimitsSet(perAddressDaily_, globalDaily_);
    }

    // ---------------------------------------------------------------- claims

    /// @notice Claims `amount` of the token to `msg.sender`, within today's per-address and global limits.
    /// @param amount Amount to claim; must be non-zero.
    /// @param deadline Last valid timestamp of the voucher (inclusive). Ignored in open mode.
    /// @param sig 65-byte ECDSA signature by `signer` over `Claim(msg.sender, amount, deadline)`. Ignored in open mode.
    function claim(uint256 amount, uint256 deadline, bytes calldata sig) external nonReentrant {
        if (paused) revert DispenserPaused();
        if (amount == 0) revert ZeroAmount();

        address signer_ = signer;
        if (signer_ != address(0)) {
            // forge-lint: disable-next-line(block-timestamp)
            if (block.timestamp > deadline) revert SignatureExpired(deadline);
            (address recovered, ECDSA.RecoverError err,) =
                ECDSA.tryRecoverCalldata(claimDigest(msg.sender, amount, deadline), sig);
            if (err != ECDSA.RecoverError.NoError || recovered != signer_) revert InvalidSignature();
        }

        uint256 day = currentDay();
        uint256 byAccount = claimedBy[day][msg.sender];
        uint256 total = claimedTotal[day];
        uint256 addressRemaining = Math.saturatingSub(perAddressDaily, byAccount);
        if (amount > addressRemaining) revert AddressLimitExceeded(amount, addressRemaining);
        uint256 globalRemaining = Math.saturatingSub(globalDaily, total);
        if (amount > globalRemaining) revert GlobalLimitExceeded(amount, globalRemaining);
        uint256 balance = TOKEN.balanceOf(address(this));
        if (amount > balance) revert InsufficientBalance(amount, balance);

        claimedBy[day][msg.sender] = byAccount + amount;
        claimedTotal[day] = total + amount;
        // The only prior external call is `balanceOf` on the immutable token; the event precedes the transfer.
        // forge-lint: disable-next-line(reentrancy-events)
        emit Claimed(msg.sender, amount, day);

        TOKEN.safeTransfer(msg.sender, amount);
    }

    /// @notice Amount `account` can claim right now: the minimum of its remaining per-address limit, the remaining
    /// global limit and the dispenser balance. Zero while paused. Ignores voucher requirements.
    /// @param account The prospective claimer.
    /// @return The claimable amount for today.
    function claimable(address account) external view returns (uint256) {
        if (paused) return 0;
        uint256 day = currentDay();
        uint256 addressRemaining = Math.saturatingSub(perAddressDaily, claimedBy[day][account]);
        uint256 globalRemaining = Math.saturatingSub(globalDaily, claimedTotal[day]);
        return Math.min(Math.min(addressRemaining, globalRemaining), TOKEN.balanceOf(address(this)));
    }

    /// @notice The current day index used for limits (`block.timestamp / 1 days`).
    /// @return The day index.
    function currentDay() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice The EIP-712 digest the signer must sign for a voucher.
    /// @param to The claimer (must be the `msg.sender` of `claim`).
    /// @param amount The exact claim amount.
    /// @param deadline Last valid timestamp (inclusive).
    /// @return The typed-data digest.
    function claimDigest(address to, uint256 amount, uint256 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, to, amount, deadline)));
    }

    /// @notice The EIP-712 domain separator (name "Baserate MUSD Dispenser", version "1").
    /// @return The domain separator for the current chain.
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------- admin

    /// @notice Sets the daily limits. Takes effect immediately, including for today's running totals.
    /// @param perAddressDaily_ New per-address daily limit.
    /// @param globalDaily_ New global daily limit.
    function setLimits(uint256 perAddressDaily_, uint256 globalDaily_) external onlyOwner {
        perAddressDaily = perAddressDaily_;
        globalDaily = globalDaily_;
        emit LimitsSet(perAddressDaily_, globalDaily_);
    }

    /// @notice Sets the voucher signer. `address(0)` switches to open mode.
    /// @param signer_ The new signer.
    // forge-lint: disable-next-line(missing-zero-check)
    function setSigner(address signer_) external onlyOwner {
        signer = signer_; // address(0) is valid: it selects open mode
        emit SignerSet(signer_);
    }

    /// @notice Pauses or unpauses claims.
    /// @param paused_ The new paused state.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    /// @notice Withdraws dispenser funds.
    /// @param to Recipient.
    /// @param amount Amount of the token to send.
    function sweep(address to, uint256 amount) external nonReentrant onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        TOKEN.safeTransfer(to, amount);
        emit Swept(to, amount);
    }

    /// @notice Disabled: renouncing would strand the dispenser balance, since only the owner can sweep.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }
}

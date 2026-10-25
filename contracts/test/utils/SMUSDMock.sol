// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

interface IPCVLike {
    function distributeMUSD() external;
}

/// @notice Local replica of Mezo's MUSDSavingsRate (sMUSD), implementation 0x92D1...D98C (testnet) /
/// 0xB33C...9e87 (mainnet), which share identical verified source (solc 0.8.33).
/// @dev Mirrors, line for line where it matters:
/// - 1:1 shares; `deposit`, `withdraw` and `claimYield` are `nonReentrant`; `receiveProtocolYield` is not;
/// - `deposit`/`withdraw` call `pcv.distributeMUSD()` in try/catch only when `pcv != 0`;
/// - `withdraw` auto-claims the caller's yield before burning;
/// - the yield index (`yieldIndex`, `supplyYieldIndex`, `claimableYield`), `pendingYield` buffering at zero supply,
///   and `AmountTooSmall` when `amount * 1e18 / totalSupply == 0`;
/// - every balance change first runs `_updateYieldFor(from)` and `_updateYieldFor(to)` (OZ4 `_beforeTokenTransfer`).
/// The live strategy is an IdleStrategy that holds principal and yields 0; here principal simply stays in the mock.
/// Fault switches let tests make `deposit`, `withdraw` or `claimYield` revert (an upgraded or broken sMUSD).
contract SMUSDMock is ERC20, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    error ZeroAmount();
    error InsufficientBalance();
    error AmountTooSmall();
    error Disabled();

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event ProtocolYieldReceived(uint256 amount);
    event YieldClaimed(address indexed user, uint256 amount);
    event PCVDistributeMUSDFailed(address pcv);

    IERC20 public immutable musdToken;
    address public pcv;
    address public strategy;
    address public vaultGauge;

    uint256 public yieldIndex;
    mapping(address => uint256) public supplyYieldIndex;
    mapping(address => uint256) public claimableYield;
    uint256 public pendingYield;

    bool public depositDisabled;
    bool public withdrawDisabled;
    bool public claimDisabled;

    constructor(address musd) ERC20("MUSD Savings Rate", "sMUSD") {
        musdToken = IERC20(musd);
    }

    // ----- test switches -----

    function setPcv(address newPcv) external {
        pcv = newPcv;
    }

    function setDisabled(bool deposit_, bool withdraw_, bool claim_) external {
        depositDisabled = deposit_;
        withdrawDisabled = withdraw_;
        claimDisabled = claim_;
    }

    // ----- MUSDSavingsRate surface -----

    function deposit(uint256 amount) external nonReentrant {
        if (depositDisabled) revert Disabled();
        if (amount == 0) revert ZeroAmount();
        _distributePcv();
        musdToken.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount);
        emit Deposit(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (withdrawDisabled) revert Disabled();
        if (amount == 0) revert ZeroAmount();
        if (balanceOf(msg.sender) < amount) revert InsufficientBalance();
        _distributePcv();
        _claimYield(msg.sender);
        _burn(msg.sender, amount);
        musdToken.safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, amount);
    }

    function claimYield() external nonReentrant returns (uint256) {
        if (claimDisabled) revert Disabled();
        return _claimYield(msg.sender);
    }

    function receiveProtocolYield(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        musdToken.safeTransferFrom(msg.sender, address(this), amount);
        _receiveYield(amount);
        emit ProtocolYieldReceived(amount);
    }

    // ----- internals (same arithmetic as the live contract) -----

    function _distributePcv() internal {
        if (pcv != address(0)) {
            try IPCVLike(pcv).distributeMUSD() {}
            catch {
                emit PCVDistributeMUSDFailed(pcv);
            }
        }
    }

    function _claimYield(address depositor) internal returns (uint256 claimable) {
        _updateYieldFor(depositor);
        claimable = claimableYield[depositor];
        if (claimable > 0) {
            claimableYield[depositor] -= claimable;
            musdToken.safeTransfer(depositor, claimable);
            emit YieldClaimed(depositor, claimable);
        }
    }

    function _receiveYield(uint256 amount) internal {
        uint256 supply = totalSupply();
        if (supply > 0) {
            uint256 toDistribute = amount + pendingYield;
            pendingYield = 0;
            uint256 ratio = (toDistribute * 1e18) / supply;
            if (ratio > 0) yieldIndex += ratio;
            else revert AmountTooSmall();
        } else {
            pendingYield += amount;
        }
    }

    function _updateYieldFor(address recipient) internal {
        uint256 supplied = balanceOf(recipient);
        if (supplied > 0) {
            uint256 userIndex = supplyYieldIndex[recipient];
            uint256 index = yieldIndex;
            supplyYieldIndex[recipient] = index;
            uint256 delta = index - userIndex;
            if (delta > 0) claimableYield[recipient] += (supplied * delta) / 1e18;
        } else {
            supplyYieldIndex[recipient] = yieldIndex;
        }
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != to) {
            _updateYieldFor(from);
            _updateYieldFor(to);
        }
        super._update(from, to, value);
    }
}

/// @notice PCV stand-in: on `distributeMUSD()` it donates its queued MUSD to sMUSD via `receiveProtocolYield`,
/// re-entering sMUSD from inside its `nonReentrant` deposit/withdraw exactly like the live PCV.
contract PCVMock is IPCVLike {
    using SafeERC20 for IERC20;

    IERC20 public immutable musd;
    SMUSDMock public immutable smusd;
    uint256 public queued;
    bool public shouldRevert;

    constructor(address musd_, address smusd_) {
        musd = IERC20(musd_);
        smusd = SMUSDMock(smusd_);
    }

    function queue(uint256 amount) external {
        queued = amount;
    }

    function setRevert(bool value) external {
        shouldRevert = value;
    }

    function distributeMUSD() external {
        require(!shouldRevert, "PCVMock: revert");
        uint256 amount = queued;
        if (amount == 0) return;
        queued = 0;
        musd.forceApprove(address(smusd), amount);
        smusd.receiveProtocolYield(amount);
    }
}

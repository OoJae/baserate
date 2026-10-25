// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IFeeRouter} from "../../src/interfaces/IFeeRouter.sol";

/// @notice Local stand-in for Mezo's PoolsVoter: the gauge registry, liveness, the token whitelist and kill rights.
/// @dev Tests make liveness reads fail with `vm.mockCallRevert` on `isAlive`.
contract MockPoolsVoter {
    error NotEmergencyCouncil();

    mapping(address gauge => bool) public isGauge;
    mapping(address gauge => bool) public isAlive;
    mapping(address gauge => address) public gaugeToBribe;
    mapping(address token => bool) public isWhitelistedToken;
    address public emergencyCouncil;

    constructor() {
        emergencyCouncil = msg.sender;
    }

    function addGauge(address gauge, address bribe) external {
        isGauge[gauge] = true;
        isAlive[gauge] = true;
        gaugeToBribe[gauge] = bribe;
    }

    function setWhitelisted(address token, bool ok) external {
        isWhitelistedToken[token] = ok;
    }

    function setAlive(address gauge, bool alive) external {
        isAlive[gauge] = alive;
    }

    function killGauge(address gauge) external {
        if (msg.sender != emergencyCouncil) revert NotEmergencyCouncil();
        isAlive[gauge] = false;
    }

    function epochStart(uint256 timestamp) external pure returns (uint256) {
        return timestamp - (timestamp % 7 days);
    }
}

/// @notice Mirrors Mezo's BribeVotingReward `notifyRewardAmount` (verified source, solc 0.8.24): `nonReentrant`,
/// whitelist check only for new reward tokens, `ZeroAmount` on 0, `safeTransferFrom` of exactly `amount`, and
/// crediting `tokenRewardsPerEpoch[token][epochStart(now)]`. `totalSupply` is the vote weight in the contract
/// (Reward's public `totalSupply`); it starts non-zero so bribes post by default. Fault modes simulate a broken or
/// hostile bribe.
contract MockBribe {
    using SafeERC20 for IERC20;

    enum Mode {
        NORMAL,
        REVERT,
        BURN_GAS,
        REENTER
    }

    error NotWhitelisted();
    error ZeroAmount();
    error Reentrant();

    address public immutable voter;
    mapping(address token => bool) public isReward;
    mapping(address token => mapping(uint256 epochStart => uint256)) public tokenRewardsPerEpoch;
    Mode public mode;
    address public reenterTarget;
    uint256 public totalSupply;
    bool internal _entered;

    constructor(address voter_, address[] memory rewards) {
        voter = voter_;
        totalSupply = 1000e18;
        for (uint256 i; i < rewards.length; ++i) {
            isReward[rewards[i]] = true;
        }
    }

    function setMode(Mode m) external {
        mode = m;
    }

    function setReenterTarget(address target) external {
        reenterTarget = target;
    }

    /// @notice Sets the vote weight (0 = nobody votes for this gauge).
    function setTotalSupply(uint256 supply) external {
        totalSupply = supply;
    }

    function notifyRewardAmount(address token, uint256 amount) external {
        if (_entered) revert Reentrant();
        _entered = true;
        if (mode == Mode.REVERT) revert("bribe down");
        if (mode == Mode.BURN_GAS) _burnAllGas();
        if (mode == Mode.REENTER) IFeeRouter(reenterTarget).distribute();
        if (!isReward[token]) {
            if (!MockPoolsVoter(voter).isWhitelistedToken(token)) revert NotWhitelisted();
            isReward[token] = true;
        }
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        tokenRewardsPerEpoch[token][block.timestamp - (block.timestamp % 7 days)] += amount;
        _entered = false;
    }

    function _burnAllGas() internal view {
        uint256 x = block.timestamp;
        while (gasleft() > 0) {
            x = uint256(keccak256(abi.encode(x)));
        }
    }
}

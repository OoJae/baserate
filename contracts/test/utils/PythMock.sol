// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IPythLite} from "../../src/interfaces/external/IPythLite.sol";

/// @notice Stand-in for Pyth's `getPriceUnsafe`, with per-feed failure modes for oracle tests.
/// @dev NORMAL returns the stored price (all zeros for an unset feed). REVERT mimics `PriceFeedNotFound`. RAW returns
/// arbitrary bytes (short, long or dirty encodings). GAS_BOMB burns all forwarded gas. RETURN_BOMB returns
/// `bombSize` bytes of zeroed memory.
contract PythMock is IPythLite {
    enum Mode {
        NORMAL,
        REVERT,
        RAW,
        GAS_BOMB,
        RETURN_BOMB
    }

    error PriceFeedNotFound();

    mapping(bytes32 => Price) internal _prices;
    mapping(bytes32 => bytes) internal _raw;
    mapping(bytes32 => Mode) public modeOf;
    uint256 public bombSize = 100_000;

    function setPrice(bytes32 id, int64 price, int32 expo, uint256 publishTime) external {
        _prices[id] = Price({price: price, conf: 0, expo: expo, publishTime: publishTime});
        modeOf[id] = Mode.NORMAL;
    }

    function setMode(bytes32 id, Mode mode) external {
        modeOf[id] = mode;
    }

    function setRaw(bytes32 id, bytes calldata data) external {
        _raw[id] = data;
        modeOf[id] = Mode.RAW;
    }

    function setBombSize(uint256 size) external {
        bombSize = size;
    }

    function getPriceUnsafe(bytes32 id) external view returns (Price memory) {
        Mode mode = modeOf[id];
        if (mode == Mode.REVERT) revert PriceFeedNotFound();
        if (mode == Mode.GAS_BOMB) _burnAllGas();
        if (mode == Mode.RAW) {
            bytes memory data = _raw[id];
            assembly ("memory-safe") {
                return(add(data, 0x20), mload(data))
            }
        }
        if (mode == Mode.RETURN_BOMB) {
            uint256 size = bombSize;
            assembly ("memory-safe") {
                return(0, size)
            }
        }
        return _prices[id];
    }

    function _burnAllGas() internal view {
        uint256 x = block.timestamp;
        while (gasleft() > 0) {
            x = uint256(keccak256(abi.encode(x)));
        }
    }
}

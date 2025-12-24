// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {euint64} from "@fhevm/solidity/lib/FHE.sol";

contract SecretUSDT is ERC7984, ZamaEthereumConfig {
    address public owner;
    address public minter;

    event MinterUpdated(address indexed previousMinter, address indexed newMinter);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error UnauthorizedCaller(address caller);
    error ZeroAddress();

    constructor() ERC7984("sUSDT", "sUSDT", "") {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert UnauthorizedCaller(msg.sender);
        _;
    }

    modifier onlyMinter() {
        if (msg.sender != minter) revert UnauthorizedCaller(msg.sender);
        _;
    }

    function decimals() public view override returns (uint8) {
        return 18;
    }

    function setMinter(address newMinter) external onlyOwner {
        if (newMinter == address(0)) revert ZeroAddress();
        address previousMinter = minter;
        minter = newMinter;
        emit MinterUpdated(previousMinter, newMinter);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function mint(address to, euint64 amount) external onlyMinter returns (euint64) {
        return _mint(to, amount);
    }

    function burnFrom(address from, euint64 amount) external onlyMinter returns (euint64) {
        return _burn(from, amount);
    }
}

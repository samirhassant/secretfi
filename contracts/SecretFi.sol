// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, ebool, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHESafeMath} from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";
import {SecretUSDT} from "./SecretUSDT.sol";

contract SecretFi is ZamaEthereumConfig {
    uint64 public constant BORROW_DIVISOR = 2;

    SecretUSDT public immutable susdt;

    mapping(address user => euint64 amount) private _stakes;
    mapping(address user => euint64 amount) private _debts;

    struct WithdrawRequest {
        address recipient;
        euint64 amount;
    }

    mapping(uint256 requestId => WithdrawRequest request) private _withdrawRequests;
    uint256 private _nextWithdrawRequestId;

    event Staked(address indexed user, euint64 amount);
    event Borrowed(address indexed user, euint64 requested, euint64 minted);
    event Repaid(address indexed user, euint64 burned);
    event WithdrawRequested(address indexed user, uint256 indexed requestId, euint64 amount);
    event WithdrawFinalized(address indexed user, uint256 indexed requestId, euint64 amount, uint64 clearAmount);

    error ZeroAmount();
    error AmountTooLarge();
    error InvalidWithdrawRequest(uint256 requestId);
    error EthTransferFailed();
    error InvalidTokenAddress();

    constructor(address susdtAddress) {
        if (susdtAddress == address(0)) revert InvalidTokenAddress();
        susdt = SecretUSDT(susdtAddress);
    }

    function stake() external payable {
        if (msg.value == 0) revert ZeroAmount();
        if (msg.value > type(uint64).max) revert AmountTooLarge();

        euint64 amount = FHE.asEuint64(uint64(msg.value));
        euint64 newStake = FHE.add(_stakes[msg.sender], amount);
        _stakes[msg.sender] = _allowValue(newStake, msg.sender);

        emit Staked(msg.sender, amount);
    }

    function borrow(externalEuint64 amount, bytes calldata inputProof) external {
        euint64 requested = FHE.fromExternal(amount, inputProof);
        euint64 stakeAmount = _stakes[msg.sender];
        euint64 debtAmount = _debts[msg.sender];

        euint64 maxBorrow = FHE.div(stakeAmount, BORROW_DIVISOR);
        (ebool ok, euint64 remaining) = FHESafeMath.tryDecrease(maxBorrow, debtAmount);
        euint64 available = FHE.select(ok, remaining, FHE.asEuint64(0));

        ebool canBorrow = FHE.le(requested, available);
        euint64 actual = FHE.select(canBorrow, requested, available);

        euint64 newDebt = FHE.add(debtAmount, actual);
        _debts[msg.sender] = _allowValue(newDebt, msg.sender);

        euint64 minted = susdt.mint(msg.sender, actual);
        FHE.allow(minted, msg.sender);

        emit Borrowed(msg.sender, requested, minted);
    }

    function repay(externalEuint64 amount, bytes calldata inputProof) external {
        euint64 requested = FHE.fromExternal(amount, inputProof);
        euint64 debtAmount = _debts[msg.sender];

        ebool isWithinDebt = FHE.le(requested, debtAmount);
        euint64 repayAmount = FHE.select(isWithinDebt, requested, debtAmount);

        euint64 burned = susdt.burnFrom(msg.sender, repayAmount);
        (ebool ok, euint64 remaining) = FHESafeMath.tryDecrease(debtAmount, burned);
        euint64 newDebt = FHE.select(ok, remaining, FHE.asEuint64(0));
        _debts[msg.sender] = _allowValue(newDebt, msg.sender);

        emit Repaid(msg.sender, burned);
    }

    function requestWithdraw(externalEuint64 amount, bytes calldata inputProof) external returns (uint256 requestId) {
        euint64 requested = FHE.fromExternal(amount, inputProof);
        euint64 stakeAmount = _stakes[msg.sender];
        euint64 debtAmount = _debts[msg.sender];

        euint64 requiredCollateral = FHE.mul(debtAmount, BORROW_DIVISOR);
        (ebool ok, euint64 remaining) = FHESafeMath.tryDecrease(stakeAmount, requiredCollateral);
        euint64 withdrawable = FHE.select(ok, remaining, FHE.asEuint64(0));

        ebool canWithdraw = FHE.le(requested, withdrawable);
        euint64 actual = FHE.select(canWithdraw, requested, withdrawable);

        (ebool stakeOk, euint64 newStakeTmp) = FHESafeMath.tryDecrease(stakeAmount, actual);
        euint64 newStake = FHE.select(stakeOk, newStakeTmp, stakeAmount);
        _stakes[msg.sender] = _allowValue(newStake, msg.sender);

        FHE.makePubliclyDecryptable(actual);

        requestId = ++_nextWithdrawRequestId;
        _withdrawRequests[requestId] = WithdrawRequest({recipient: msg.sender, amount: actual});

        emit WithdrawRequested(msg.sender, requestId, actual);
    }

    function finalizeWithdraw(uint256 requestId, uint64 clearAmount, bytes calldata decryptionProof) external {
        WithdrawRequest memory request = _withdrawRequests[requestId];
        if (request.recipient == address(0)) revert InvalidWithdrawRequest(requestId);
        delete _withdrawRequests[requestId];

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint64.unwrap(request.amount);

        bytes memory cleartexts = abi.encode(clearAmount);
        FHE.checkSignatures(handles, cleartexts, decryptionProof);

        (bool success, ) = payable(request.recipient).call{value: clearAmount}("");
        if (!success) revert EthTransferFailed();

        emit WithdrawFinalized(request.recipient, requestId, request.amount, clearAmount);
    }

    function getStake(address account) external view returns (euint64) {
        return _stakes[account];
    }

    function getDebt(address account) external view returns (euint64) {
        return _debts[account];
    }

    function getWithdrawRequest(uint256 requestId) external view returns (address recipient, euint64 amount) {
        WithdrawRequest memory request = _withdrawRequests[requestId];
        return (request.recipient, request.amount);
    }

    function _allowValue(euint64 value, address account) internal returns (euint64) {
        FHE.allowThis(value);
        FHE.allow(value, account);
        return value;
    }
}

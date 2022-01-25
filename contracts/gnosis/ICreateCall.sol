// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

/// @title Create Call - Allows to use the different create opcodes to deploy a contract
/// @author Richard Meissner - <richard@gnosis.io>
interface ICreateCall {
    function performCreate2(
        uint256 value,
        bytes memory deploymentData,
        bytes32 salt
    ) external returns (address newContract);

    function performCreate(uint256 value, bytes memory deploymentData) external returns (address newContract);
}

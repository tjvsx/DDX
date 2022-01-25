// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

/// @title Proxy Factory - Allows to create new proxy contact and execute a message call to the new proxy within one
///        transaction.
/// @author Stefan George - <stefan@gnosis.pm>
interface IGnosisSafeProxyFactory {
    /// @dev Allows to create new proxy contact and execute a message call to the new proxy within one transaction.
    /// @param _mastercopy Address of master copy.
    /// @param initializer Payload for message call sent to new proxy contract.
    /// @param saltNonce Nonce that will be used to generate the salt to calculate the address of the new proxy
    ///        contract.
    function createProxyWithNonce(
        address _mastercopy,
        bytes memory initializer,
        uint256 saltNonce
    ) external returns (address proxy);

    /// @dev Allows to create new proxy contact, execute a message call to the new proxy and call a specified callback
    ///      within one transaction
    /// @param _mastercopy Address of master copy.
    /// @param initializer Payload for message call sent to new proxy contract.
    /// @param saltNonce Nonce that will be used to generate the salt to calculate the address of the new proxy
    ///        contract.
    /// @param callback Callback that will be invoced after the new proxy contract has been successfully deployed and
    ///        initialized.
    function createProxyWithCallback(
        address _mastercopy,
        bytes memory initializer,
        uint256 saltNonce,
        IProxyCreationCallback callback
    ) external returns (address proxy);

    /// @dev Allows to get the address for a new proxy contact created via `createProxyWithNonce`
    ///      This method is only meant for address calculation purpose when you use an initializer that would revert,
    ///      therefore the response is returned with a revert. When calling this method set `from` to the address of
    ///      the proxy factory.
    /// @param _mastercopy Address of master copy.
    /// @param initializer Payload for message call sent to new proxy contract.
    /// @param saltNonce Nonce that will be used to generate the salt to calculate the address of the new proxy
    ///        contract.
    function calculateCreateProxyWithNonceAddress(
        address _mastercopy,
        bytes calldata initializer,
        uint256 saltNonce
    ) external returns (address proxy);

    /// @dev Allows to create new proxy contact and execute a message call to the new proxy within one transaction.
    /// @param masterCopy Address of master copy.
    /// @param data Payload for message call sent to new proxy contract.
    function createProxy(address masterCopy, bytes memory data) external returns (address proxy);

    /// @dev Allows to retrieve the runtime code of a deployed Proxy. This can be used to check that the expected Proxy
    ///      was deployed.
    function proxyRuntimeCode() external pure returns (bytes memory);

    /// @dev Allows to retrieve the creation code used for the Proxy deployment. With this it is easily possible to
    ///      calculate predicted address.
    function proxyCreationCode() external pure returns (bytes memory);
}

interface IProxyCreationCallback {
    function proxyCreated(
        address proxy,
        address _mastercopy,
        bytes calldata initializer,
        uint256 saltNonce
    ) external;
}

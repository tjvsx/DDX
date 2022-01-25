/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
    solidity: {
        compilers: [
            {
                version: '0.8.4',
                settings: {
                    evmVersion: 'istanbul',
                    optimizer: {
                        enabled: true,
                        runs: 50000,
                        details: {
                            yul: false,
                            deduplicate: true,
                            cse: true,
                            constantOptimizer: true,
                        },
                    },
                    outputSelection: {
                        '*': {
                            '*': [
                                'abi',
                                'devdoc',
                                'evm.bytecode.linkReferences',
                                'evm.bytecode.object',
                                'evm.bytecode.sourceMap',
                                'evm.deployedBytecode.object',
                                'evm.deployedBytecode.sourceMap',
                                'evm.gasEstimates',
                            ],
                        },
                    },
                },
            },
        ],
    },
    networks: {
        local: {
            blockGasLimit: 10000000,
            url: 'http://localhost:8545',
        },
        hardhat: {
            blockGasLimit: 10000000,
        },
    },
    paths: {
        sources: './contracts',
        cache: './cache',
        artifacts: './artifacts',
    },
    mocha: {
        timeout: 3600000,
    },
};

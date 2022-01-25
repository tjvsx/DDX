import { BaseContract } from '@0x/base-contract';
import { MnemonicWalletSubprovider, RPCSubprovider, Web3ProviderEngine } from '@0x/subproviders';
import { providerUtils } from '@0x/utils';
import { BASE_DERIVATION_PATH, NETWORK_CONFIGS } from '@derivadex/contract-addresses';
import { Derivadex } from '@derivadex/contract-wrappers';
import { ContractAddresses, ObjectMap } from '@derivadex/types';
import { SupportedProvider } from 'ethereum-types';

import { Deployer } from './deployer';
import { fromPartialContractAddresses } from './utils';

export interface DDXDeployment {
    accounts: string[];
    owner: string;
    derivadex: Derivadex;
    contractWrappers: ObjectMap<BaseContract>;
    contractAddresses: ContractAddresses;
}

export interface SetupConfig {
    isFork: boolean;
    isGanache: boolean;
    useDeployedDDXToken: boolean;
}

/**
 * Setup deployment using a network key.
 * @param networkKey The desired network key.
 * @returns Deployment of the DerivaDEX smart contracts.
 */
export async function setupAsync(networkKey: string): Promise<DDXDeployment> {
    if (networkKey !== 'Ganache' && networkKey !== 'Kovan') {
        throw new Error(`${networkKey} is not a valid network key. Must use "Ganache" or "Kovan"`);
    }
    const rpcUrl = process.env.RPC_URL || NETWORK_CONFIGS[networkKey].rpcUrl;
    const provider = new Web3ProviderEngine();
    console.log(`- ctor: networkKey: ${networkKey}`);
    if (networkKey !== 'Ganache') {
        console.log('- ctor: Adding MneminocSubprovider - BEGIN');
        provider.addProvider(
            new MnemonicWalletSubprovider({
                mnemonic: process.env.MNEMONIC as string | '',
                baseDerivationPath: BASE_DERIVATION_PATH,
            }),
        );
        console.log('- ctor: Adding MneminocSubprovider - COMPLETE');
    }
    provider.addProvider(new RPCSubprovider(rpcUrl));
    provider.start();
    return setupWithProviderAsync(provider, {
        isFork: process.env.FORK === 'true',
        isGanache: networkKey === 'Ganache',
        useDeployedDDXToken: process.env.USE_DEPLOYED_DDX_TOKEN === 'true',
    });
}

/**
 * Setup deployment using a provider.
 * @param provider A supported provider.
 * @returns Deployment of the DerivaDEX smart contracts.
 */
export async function setupWithProviderAsync(provider: SupportedProvider, config: SetupConfig): Promise<DDXDeployment> {
    const chainId = await providerUtils.getChainIdAsync(provider);
    const deployer = new Deployer({
        chainId,
        provider,
        ...config,
    });
    const contractAddresses = fromPartialContractAddresses(await deployer.deployAsync());
    const derivadex = new Derivadex(
        {
            derivaDEXAddress: deployer.contracts.derivaDEX.address,
            governanceAddress: deployer.contracts.governance.address,
            insuranceFundAddress: deployer.contracts.insuranceFund.address,
            traderAddress: deployer.contracts.trader.address,
            pauseAddress: deployer.contracts.pause.address,
            ddxWalletCloneableAddress: deployer.contracts.ddxWalletCloneable.address,
            diFundTokenFactoryAddress: deployer.contracts.diFundTokenFactory.address,
            ddxAddress: deployer.contracts.ddx.address,
            usdtAddress: deployer.contracts.usdt ? deployer.contracts.usdt.address : '',
            ausdtAddress: deployer.contracts.ausdt ? deployer.contracts.ausdt.address : '',
            cusdtAddress: deployer.contracts.cusdt ? deployer.contracts.cusdt.address : '',
            usdcAddress: deployer.contracts.usdc ? deployer.contracts.usdc.address : '',
            ausdcAddress: deployer.contracts.ausdc ? deployer.contracts.ausdc.address : '',
            cusdcAddress: deployer.contracts.cusdc ? deployer.contracts.cusdc.address : '',
            husdAddress: deployer.contracts.husd ? deployer.contracts.husd.address : '',
            gusdAddress: deployer.contracts.gusd ? deployer.contracts.gusd.address : '',
            gnosisSafeAddress: deployer.contracts.gnosisSafeAddress ? deployer.contracts.gnosisSafeAddress.address : '',
            gnosisSafeProxyFactoryAddress: deployer.contracts.gnosisSafeProxyFactoryAddress
                ? deployer.contracts.gnosisSafeProxyFactoryAddress.address
                : '',
            gnosisSafeProxyAddress: deployer.contracts.gnosisSafeProxyAddress
                ? deployer.contracts.gnosisSafeProxyAddress.address
                : '',
            createCallAddress: deployer.contracts.createCallAddress ? deployer.contracts.createCallAddress.address : '',
        },
        provider,
        chainId,
    );
    return {
        accounts: deployer.accounts,
        owner: deployer.owner,
        derivadex,
        contractWrappers: deployer.contracts,
        contractAddresses,
    };
}

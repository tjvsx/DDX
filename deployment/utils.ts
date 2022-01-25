import { ContractAddresses } from '@derivadex/types';

/**
 * Converts any undefined fields of a partial ContractAddresses object to empty
 * strings.
 * @param addresses The parial ContractAddresses object to base the result
 *        ContractAddresses off of.
 */
export function fromPartialContractAddresses(addresses: Partial<ContractAddresses>): ContractAddresses {
    return {
        ddxAddress: '',
        ddxWalletCloneableAddress: '',
        derivaDEXAddress: '',
        diFundTokenFactoryAddress: '',
        insuranceFundAddress: '',
        governanceAddress: '',
        pauseAddress: '',
        traderAddress: '',
        ausdcAddress: '',
        cusdcAddress: '',
        usdcAddress: '',
        ausdtAddress: '',
        cusdtAddress: '',
        usdtAddress: '',
        gusdAddress: '',
        husdAddress: '',
        gnosisSafeAddress: '',
        gnosisSafeProxyFactoryAddress: '',
        gnosisSafeProxyAddress: '',
        createCallAddress: '',
        ...addresses,
    };
}

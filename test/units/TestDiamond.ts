import { Web3Wrapper } from '@0x/web3-wrapper';
import { Derivadex } from '@derivadex/contract-wrappers';
import { advanceBlocksAsync, getSelectors } from '@derivadex/dev-utils';
import { expect } from '@derivadex/test-utils';
import { FacetCutAction } from '@derivadex/types';
import { ethers } from 'ethers';
import * as hardhat from 'hardhat';
import * as _ from 'lodash';

import { setupWithProviderAsync } from '../../deployment/setup';
import { Fixtures, ZERO_ADDRESS } from '../fixtures';

describe('#Diamond', () => {
    let derivadex: Derivadex;
    let accounts: string[];
    let owner: string;
    let fixtures: Fixtures;

    describe('Diamond Tests - #1', () => {
        before(async () => {
            // Reset the hardhat network provider to a fresh state.
            const provider = hardhat.network.provider;
            const web3Wrapper = new Web3Wrapper(provider);
            await web3Wrapper.sendRawPayloadAsync<void>({
                method: 'hardhat_reset',
                params: [],
            });

            ({ derivadex, accounts, owner } = await setupWithProviderAsync(provider, {
                isFork: false,
                isGanache: true,
                useDeployedDDXToken: false,
            }));
            fixtures = new Fixtures(derivadex, accounts, owner);

            await derivadex
                .transferOwnershipToDerivaDEXProxyDDX(derivadex.derivaDEXContract.address)
                .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });

            await advanceBlocksAsync(derivadex.providerEngine, 1);
        });

        it('adds a facet and selectors', async () => {
            let facetAddresses = await derivadex.diamondFacetContract.facetAddresses().callAsync();
            expect(facetAddresses.length).to.eq(2);
            const diamondFacetSelectors = getSelectors(new ethers.utils.Interface(derivadex.diamondFacetContract.abi));
            const diamondFacetLoupeSelectors = await derivadex.diamondFacetContract
                .facetFunctionSelectors(facetAddresses[0])
                .callAsync();
            expect(_.isEqual(_.sortBy(diamondFacetSelectors), _.sortBy(diamondFacetLoupeSelectors))).to.eq(true);
            const ownershipFacetSelectors = getSelectors(
                new ethers.utils.Interface(derivadex.ownershipFacetContract.abi),
            );
            const ownershipFacetLoupeSelectors = await derivadex.diamondFacetContract
                .facetFunctionSelectors(facetAddresses[1])
                .callAsync();
            expect(_.isEqual(_.sortBy(ownershipFacetSelectors), _.sortBy(ownershipFacetLoupeSelectors))).to.eq(true);

            const pauseSelectors = getSelectors(new ethers.utils.Interface(derivadex.pauseContract.abi));
            await derivadex
                .diamondCut(
                    [
                        {
                            facetAddress: derivadex.pauseContract.address,
                            action: FacetCutAction.Add,
                            functionSelectors: pauseSelectors,
                        },
                    ],
                    derivadex.pauseContract.address,
                    derivadex.initializePause().getABIEncodedTransactionData(),
                )
                .awaitTransactionSuccessAsync({ from: owner });

            facetAddresses = await derivadex.diamondFacetContract.facetAddresses().callAsync();
            expect(facetAddresses.length).to.eq(3);
            expect(facetAddresses[facetAddresses.length - 1]).to.eq(derivadex.pauseContract.address);
            const pauseLoupeSelectors = await derivadex.diamondFacetContract
                .facetFunctionSelectors(facetAddresses[2])
                .callAsync();
            expect(_.isEqual(_.sortBy(pauseSelectors), _.sortBy(pauseLoupeSelectors))).to.eq(true);
        });

        it('removes selectors', async () => {
            const pauseSelectors = getSelectors(new ethers.utils.Interface(derivadex.pauseContract.abi));
            await derivadex
                .diamondCut(
                    [{ facetAddress: ZERO_ADDRESS, action: FacetCutAction.Remove, functionSelectors: pauseSelectors }],
                    ZERO_ADDRESS,
                    '0x',
                )
                .awaitTransactionSuccessAsync({ from: owner });

            let facetAddresses = await derivadex.diamondFacetContract.facetAddresses().callAsync();
            expect(facetAddresses.length).to.eq(2);

            // adding it back for remaining tests
            await derivadex
                .diamondCut(
                    [
                        {
                            facetAddress: derivadex.pauseContract.address,
                            action: FacetCutAction.Add,
                            functionSelectors: pauseSelectors,
                        },
                    ],
                    derivadex.pauseContract.address,
                    derivadex.initializePause().getABIEncodedTransactionData(),
                )
                .awaitTransactionSuccessAsync({ from: owner });

            facetAddresses = await derivadex.diamondFacetContract.facetAddresses().callAsync();
            expect(facetAddresses.length).to.eq(3);
            expect(facetAddresses[facetAddresses.length - 1]).to.eq(derivadex.pauseContract.address);
            const pauseLoupeSelectors = await derivadex.diamondFacetContract
                .facetFunctionSelectors(facetAddresses[2])
                .callAsync();
            expect(_.isEqual(_.sortBy(pauseSelectors), _.sortBy(pauseLoupeSelectors))).to.eq(true);
        });

        it('fails to add empty list of selectors', async () => {
            return expect(
                derivadex
                    .diamondCut(
                        [
                            {
                                facetAddress: derivadex.pauseContract.address,
                                action: FacetCutAction.Add,
                                functionSelectors: [],
                            },
                        ],
                        derivadex.pauseContract.address,
                        derivadex.initializePause().getABIEncodedTransactionData(),
                    )
                    .awaitTransactionSuccessAsync({ from: owner }),
            ).to.be.rejectedWith('LibDiamondCut: No selectors in facet to cut');
        });

        it('fails to facet with no code', async () => {
            const pauseSelectors = getSelectors(new ethers.utils.Interface(derivadex.pauseContract.abi));
            return expect(
                derivadex
                    .diamondCut(
                        [
                            {
                                facetAddress: '0x0000000000000000000000000000000000000001',
                                action: FacetCutAction.Add,
                                functionSelectors: pauseSelectors,
                            },
                        ],
                        derivadex.pauseContract.address,
                        derivadex.initializePause().getABIEncodedTransactionData(),
                    )
                    .awaitTransactionSuccessAsync({ from: owner }),
            ).to.be.rejectedWith('LibDiamondCut: New facet has no code');
        });

        it('fails to facet selectors that have already been added', async () => {
            const pauseSelectors = getSelectors(new ethers.utils.Interface(derivadex.pauseContract.abi));
            return expect(
                derivadex
                    .diamondCut(
                        [
                            {
                                facetAddress: derivadex.pauseContract.address,
                                action: FacetCutAction.Add,
                                functionSelectors: pauseSelectors,
                            },
                        ],
                        derivadex.pauseContract.address,
                        derivadex.initializePause().getABIEncodedTransactionData(),
                    )
                    .awaitTransactionSuccessAsync({ from: owner }),
            ).to.be.rejectedWith("LibDiamondCut: Can't add function that already exists");
        });

        it('fails to replace selectors that already exist (i.e. same facet)', async () => {
            const pauseSelectors = getSelectors(new ethers.utils.Interface(derivadex.pauseContract.abi));
            return expect(
                derivadex
                    .diamondCut(
                        [
                            {
                                facetAddress: derivadex.pauseContract.address,
                                action: FacetCutAction.Replace,
                                functionSelectors: pauseSelectors,
                            },
                        ],
                        derivadex.pauseContract.address,
                        derivadex.initializePause().getABIEncodedTransactionData(),
                    )
                    .awaitTransactionSuccessAsync({ from: owner }),
            ).to.be.rejectedWith("LibDiamondCut: Can't replace function with same function");
        });

        it('fails to add selectors when passing in zero address for facet', async () => {
            const pauseSelectors = getSelectors(new ethers.utils.Interface(derivadex.pauseContract.abi));
            return expect(
                derivadex
                    .diamondCut(
                        [{ facetAddress: ZERO_ADDRESS, action: FacetCutAction.Add, functionSelectors: pauseSelectors }],
                        derivadex.pauseContract.address,
                        derivadex.initializePause().getABIEncodedTransactionData(),
                    )
                    .awaitTransactionSuccessAsync({ from: owner }),
            ).to.be.rejectedWith('LibDiamondCut: action not set to FacetCutAction.Remove');
        });

        it('fails to remove selectors when passing in non-zero address', async () => {
            const pauseSelectors = getSelectors(new ethers.utils.Interface(derivadex.pauseContract.abi));
            return expect(
                derivadex
                    .diamondCut(
                        [
                            {
                                facetAddress: derivadex.pauseContract.address,
                                action: FacetCutAction.Remove,
                                functionSelectors: pauseSelectors,
                            },
                        ],
                        derivadex.pauseContract.address,
                        derivadex.initializePause().getABIEncodedTransactionData(),
                    )
                    .awaitTransactionSuccessAsync({ from: owner }),
            ).to.be.rejectedWith('LibDiamondCut: Incorrect FacetCutAction');
        });

        it('fails to remove selectors that do not exist', async () => {
            return expect(
                derivadex
                    .diamondCut(
                        [
                            {
                                facetAddress: ZERO_ADDRESS,
                                action: FacetCutAction.Remove,
                                functionSelectors: ['0xabababab'],
                            },
                        ],
                        derivadex.pauseContract.address,
                        derivadex.initializePause().getABIEncodedTransactionData(),
                    )
                    .awaitTransactionSuccessAsync({ from: owner }),
            ).to.be.rejectedWith("LibDiamondCut: Can't remove or replace function that doesn't exist");
        });
    });
});

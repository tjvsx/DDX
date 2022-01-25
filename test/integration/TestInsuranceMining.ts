import { BigNumber } from '@0x/utils';
import { Web3Wrapper } from '@0x/web3-wrapper';
import { Derivadex } from '@derivadex/contract-wrappers';
import { advanceBlocksAsync, advanceTimeAsync, generateCallData, getSelectors } from '@derivadex/dev-utils';
import { expect } from '@derivadex/test-utils';
import { FacetCutAction, StakeFlavor } from '@derivadex/types';
import { ethers } from 'ethers';
import * as hardhat from 'hardhat';

import { setupWithProviderAsync } from '../../deployment/setup';
import { FORK_URL } from '../constants';
import { AUSDT, CUSDT, Fixtures, GUSD, HUSD, USDT, ZERO_ADDRESS } from '../fixtures';

describe('#Insurance Mining', function() {
    let derivadex: Derivadex;
    let accounts: string[];
    let owner: string;
    let fixtures: Fixtures;

    before(async () => {
        // Reset to a fresh forked state.
        const provider = hardhat.network.provider;
        const web3Wrapper = new Web3Wrapper(provider);
        await web3Wrapper.sendRawPayloadAsync<void>({
            method: 'hardhat_reset',
            params: [
                {
                    forking: {
                        jsonRpcUrl: FORK_URL,
                    },
                },
            ],
        });

        // Set up contractWrappers and facets as standalone entities. They
        // are not yet part of the diamond.
        ({ derivadex, accounts, owner } = await setupWithProviderAsync(provider, {
            isFork: true,
            isGanache: true,
            useDeployedDDXToken: false,
        }));
        fixtures = new Fixtures(derivadex, accounts, owner);

        // Transfer ownership of DDX to the DerivaDEX Diamond. In
        // other words, the DerivaDEX contract now controls the
        // liquidity mine token supply.
        await derivadex
            .transferOwnershipToDerivaDEXProxyDDX(derivadex.derivaDEXContract.address)
            .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });

        await derivadex
            .transferDDX(fixtures.traderB(), 10000)
            .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await derivadex
            .transferDDX(fixtures.traderC(), 5000)
            .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });

        await advanceBlocksAsync(derivadex.providerEngine, 1);

        // Add Pause facet to the diamond
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
        derivadex.setPauseAddressToProxy();

        // Add Governance facet to the diamond
        const governanceSelectors = getSelectors(new ethers.utils.Interface(derivadex.governanceContract.abi), [
            'initialize',
        ]);
        await derivadex
            .diamondCut(
                [
                    {
                        facetAddress: derivadex.governanceContract.address,
                        action: FacetCutAction.Add,
                        functionSelectors: governanceSelectors,
                    },
                ],
                derivadex.governanceContract.address,
                derivadex
                    .initializeGovernance(
                        10,
                        1,
                        17280,
                        1209600,
                        0, // 259200 (3 days worth of seconds normally)
                        4,
                        1,
                        50,
                    )
                    .getABIEncodedTransactionData(),
            )
            .awaitTransactionSuccessAsync({ from: owner });
        derivadex.setGovernanceAddressToProxy();

        // Transfer ownership of DerivaDEX contract to itself, i.e.
        // governance now controls everything
        await derivadex.transferOwnershipToSelf().awaitTransactionSuccessAsync({ from: owner });

        // Add Trader facet to the diamond
        const selectors = getSelectors(new ethers.utils.Interface(derivadex.traderContract.abi), ['initialize']);
        const targets = [derivadex.derivaDEXContract.address];
        const values = [0];
        const signatures = [derivadex.diamondFacetContract.getFunctionSignature('diamondCut')];
        const calldatas = [
            generateCallData(
                derivadex
                    .diamondCut(
                        [
                            {
                                facetAddress: derivadex.traderContract.address,
                                action: FacetCutAction.Add,
                                functionSelectors: selectors,
                            },
                        ],
                        derivadex.traderContract.address,
                        derivadex
                            .initializeTrader(derivadex.ddxWalletCloneableContract.address)
                            .getABIEncodedTransactionData(),
                    )
                    .getABIEncodedTransactionData(),
            ),
        ];
        const description = 'Add Trader contract as a facet.';
        await derivadex
            .propose(targets, values, signatures, calldatas, description)
            .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await advanceBlocksAsync(derivadex.providerEngine, 2);
        await derivadex.castVote(1, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await derivadex.queue(1).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        await advanceBlocksAsync(derivadex.providerEngine, 1);
        await derivadex.execute(1).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        derivadex.setTraderAddressToProxy();
    });

    it('fails to add InsuranceFund facet bypassing Governance', async () => {
        const insuranceFundSelectors = getSelectors(new ethers.utils.Interface(derivadex.insuranceFundContract.abi), [
            'initialize',
        ]);
        await expect(
            derivadex
                .diamondCut(
                    [
                        {
                            facetAddress: derivadex.insuranceFundContract.address,
                            action: FacetCutAction.Add,
                            functionSelectors: insuranceFundSelectors,
                        },
                    ],
                    derivadex.insuranceFundContract.address,
                    derivadex
                        .initializeInsuranceFund(
                            50,
                            995,
                            1.189117199391172,
                            10,
                            2102400,
                            derivadex.diFundTokenFactoryContract.address,
                        )
                        .getABIEncodedTransactionData(),
                )
                .awaitTransactionSuccessAsync({ from: owner }),
        ).to.be.rejectedWith('DiamondFacet: Must own the contract');
    });

    it('adds new Insurance fund facet via Governance ', async () => {
        // Add InsuranceFund facet to the diamond
        const selectors = getSelectors(new ethers.utils.Interface(derivadex.insuranceFundContract.abi), ['initialize']);
        const targets = [derivadex.derivaDEXContract.address, derivadex.derivaDEXContract.address];
        const values = [0, 0];
        const signatures = [
            derivadex.diamondFacetContract.getFunctionSignature('diamondCut'),
            derivadex.insuranceFundContract.getFunctionSignature('addInsuranceFundCollateral'),
        ];
        const calldatas = [
            generateCallData(
                derivadex
                    .diamondCut(
                        [
                            {
                                facetAddress: derivadex.insuranceFundContract.address,
                                action: FacetCutAction.Add,
                                functionSelectors: selectors,
                            },
                        ],
                        derivadex.insuranceFundContract.address,
                        derivadex
                            .initializeInsuranceFund(
                                50,
                                995,
                                1.189117199391172,
                                10,
                                2102400,
                                derivadex.diFundTokenFactoryContract.address,
                            )
                            .getABIEncodedTransactionData(),
                    )
                    .getABIEncodedTransactionData(),
            ),
            generateCallData(
                derivadex
                    .addInsuranceFundCollateral(
                        USDT.collateralName,
                        USDT.collateralSymbol,
                        ZERO_ADDRESS,
                        USDT.collateralAddress,
                        USDT.collateralStakingType,
                    )
                    .getABIEncodedTransactionData(),
            ),
        ];
        const description = 'Add InsuranceFund contract as a facet.';
        await derivadex
            .propose(targets, values, signatures, calldatas, description)
            .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await advanceBlocksAsync(derivadex.providerEngine, 2);
        await derivadex.castVote(2, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await derivadex.queue(2).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        // await advanceTimeAsync(derivadex.providerEngine, 259200);
        await advanceBlocksAsync(derivadex.providerEngine, 1);
        await derivadex.execute(2).awaitTransactionSuccessAsync({ from: fixtures.traderB(), gas: 7000000 });
        derivadex.setInsuranceFundAddressToProxy();
    });

    it('check lock and unlock of stake', async () => {
        // Staking Trader A
        let lockStatus = await derivadex.getLockStatusForStakeToInsuranceFundAsync(
            CUSDT.collateralAddress,
            fixtures.traderA(),
        );
        expect(lockStatus).to.eq(false);
        await derivadex
            .approveForStakeToInsuranceFund(CUSDT.collateralAddress)
            .awaitTransactionSuccessAsync({ from: fixtures.traderA() });
        lockStatus = await derivadex.getLockStatusForStakeToInsuranceFundAsync(
            CUSDT.collateralAddress,
            fixtures.traderA(),
        );
        expect(lockStatus).to.eq(true);
        await derivadex
            .lockStakeToInsuranceFund(CUSDT.collateralAddress)
            .awaitTransactionSuccessAsync({ from: fixtures.traderA() });
        lockStatus = await derivadex.getLockStatusForStakeToInsuranceFundAsync(
            CUSDT.collateralAddress,
            fixtures.traderA(),
        );
        expect(lockStatus).to.eq(false);
    });

    it('fails to stake cUSDT to insurance fund since unsupported collateral', async () => {
        // Staking Trader A
        await derivadex
            .approveForStakeToInsuranceFund(CUSDT.collateralAddress)
            .awaitTransactionSuccessAsync({ from: fixtures.traderA() });
        const tx = derivadex
            .stakeToInsuranceFund(CUSDT.collateralName, 1000)
            .awaitTransactionSuccessAsync({ from: fixtures.traderA() });
        await expect(tx).to.be.rejectedWith('IFund: invalid collateral.');
    });

    it('fails to add HUSD collateral with zero address for collateral address', async () => {
        const targets = [derivadex.derivaDEXContract.address];
        const values = [0];
        const signatures = [derivadex.insuranceFundContract.getFunctionSignature('addInsuranceFundCollateral')];
        const calldatas = [
            generateCallData(
                derivadex
                    .addInsuranceFundCollateral(
                        HUSD.collateralName,
                        HUSD.collateralSymbol,
                        ZERO_ADDRESS,
                        ZERO_ADDRESS,
                        HUSD.collateralStakingType,
                    )
                    .getABIEncodedTransactionData(),
            ),
        ];
        const description = 'Add HUSD.';
        await derivadex
            .propose(targets, values, signatures, calldatas, description)
            .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await advanceBlocksAsync(derivadex.providerEngine, 2);
        await derivadex.castVote(3, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await derivadex.queue(3).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        await advanceBlocksAsync(derivadex.providerEngine, 1);
        await expect(
            derivadex.execute(3).awaitTransactionSuccessAsync({ from: fixtures.traderB(), gas: 7000000 }),
        ).to.be.rejectedWith('Governance: transaction execution reverted.');
    });

    it('fails to add HUSD collateral with non-zero underlying address', async () => {
        const targets = [derivadex.derivaDEXContract.address];
        const values = [0];
        const signatures = [derivadex.insuranceFundContract.getFunctionSignature('addInsuranceFundCollateral')];
        const calldatas = [
            generateCallData(
                derivadex
                    .addInsuranceFundCollateral(
                        HUSD.collateralName,
                        HUSD.collateralSymbol,
                        USDT.collateralAddress,
                        HUSD.collateralAddress,
                        HUSD.collateralStakingType,
                    )
                    .getABIEncodedTransactionData(),
            ),
        ];
        const description = 'Add HUSD.';
        await derivadex
            .propose(targets, values, signatures, calldatas, description)
            .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await advanceBlocksAsync(derivadex.providerEngine, 2);
        await derivadex.castVote(4, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await derivadex.queue(4).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        await advanceBlocksAsync(derivadex.providerEngine, 1);
        await expect(
            derivadex.execute(4).awaitTransactionSuccessAsync({ from: fixtures.traderB(), gas: 7000000 }),
        ).to.be.rejectedWith('Governance: transaction execution reverted.');
    });

    it('fails to add USDT collateral since name already added', async () => {
        const targets = [derivadex.derivaDEXContract.address];
        const values = [0];
        const signatures = [derivadex.insuranceFundContract.getFunctionSignature('addInsuranceFundCollateral')];
        const calldatas = [
            generateCallData(
                derivadex
                    .addInsuranceFundCollateral(
                        USDT.collateralName,
                        USDT.collateralSymbol,
                        ZERO_ADDRESS,
                        USDT.collateralAddress,
                        USDT.collateralStakingType,
                    )
                    .getABIEncodedTransactionData(),
            ),
        ];
        const description = 'Add USDT again.';
        await derivadex
            .propose(targets, values, signatures, calldatas, description)
            .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await advanceBlocksAsync(derivadex.providerEngine, 2);
        await derivadex.castVote(5, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await derivadex.queue(5).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        await advanceBlocksAsync(derivadex.providerEngine, 1);
        await expect(
            derivadex.execute(5).awaitTransactionSuccessAsync({ from: fixtures.traderB(), gas: 7000000 }),
        ).to.be.rejectedWith('Governance: transaction execution reverted.');
    });

    it('fails to add cUSDT collateral since same collateral and underlying token addresses', async () => {
        const targets = [derivadex.derivaDEXContract.address];
        const values = [0];
        const signatures = [derivadex.insuranceFundContract.getFunctionSignature('addInsuranceFundCollateral')];
        const calldatas = [
            generateCallData(
                derivadex
                    .addInsuranceFundCollateral(
                        CUSDT.collateralName,
                        CUSDT.collateralSymbol,
                        CUSDT.collateralAddress,
                        CUSDT.collateralAddress,
                        CUSDT.collateralStakingType,
                    )
                    .getABIEncodedTransactionData(),
            ),
        ];
        const description = 'Add cUSDT';
        await derivadex
            .propose(targets, values, signatures, calldatas, description)
            .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await advanceBlocksAsync(derivadex.providerEngine, 2);
        await derivadex.castVote(6, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await derivadex.queue(6).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        await advanceBlocksAsync(derivadex.providerEngine, 1);
        await expect(
            derivadex.execute(6).awaitTransactionSuccessAsync({ from: fixtures.traderB(), gas: 7000000 }),
        ).to.be.rejectedWith('Governance: transaction execution reverted.');
    });

    it('fails to add USDT collateral with a different name', async () => {
        const targets = [derivadex.derivaDEXContract.address];
        const values = [0];
        const signatures = [derivadex.insuranceFundContract.getFunctionSignature('addInsuranceFundCollateral')];
        const calldatas = [
            generateCallData(
                derivadex
                    .addInsuranceFundCollateral(
                        CUSDT.collateralName,
                        CUSDT.collateralSymbol,
                        ZERO_ADDRESS,
                        USDT.collateralAddress,
                        USDT.collateralStakingType,
                    )
                    .getABIEncodedTransactionData(),
            ),
        ];
        const description = 'Add USDT.';
        await derivadex
            .propose(targets, values, signatures, calldatas, description)
            .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await advanceBlocksAsync(derivadex.providerEngine, 2);
        await derivadex.castVote(7, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await derivadex.queue(7).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        await advanceBlocksAsync(derivadex.providerEngine, 1);
        await expect(
            derivadex.execute(7).awaitTransactionSuccessAsync({ from: fixtures.traderB(), gas: 7000000 }),
        ).to.be.rejectedWith('Governance: transaction execution reverted.');
    });

    it('adds cUSDT and aUSDT to insurance fund as valid collateral types ', async () => {
        const targets = [derivadex.derivaDEXContract.address, derivadex.derivaDEXContract.address];
        const values = [0, 0];
        const signatures = [
            derivadex.insuranceFundContract.getFunctionSignature('addInsuranceFundCollateral'),
            derivadex.insuranceFundContract.getFunctionSignature('addInsuranceFundCollateral'),
        ];
        const calldatas = [
            generateCallData(
                derivadex
                    .addInsuranceFundCollateral(
                        CUSDT.collateralName,
                        CUSDT.collateralSymbol,
                        USDT.collateralAddress,
                        CUSDT.collateralAddress,
                        CUSDT.collateralStakingType,
                    )
                    .getABIEncodedTransactionData(),
            ),
            generateCallData(
                derivadex
                    .addInsuranceFundCollateral(
                        AUSDT.collateralName,
                        AUSDT.collateralSymbol,
                        USDT.collateralAddress,
                        AUSDT.collateralAddress,
                        AUSDT.collateralStakingType,
                    )
                    .getABIEncodedTransactionData(),
            ),
        ];
        const description = 'Add InsuranceFund contract as a facet.';
        await derivadex
            .propose(targets, values, signatures, calldatas, description)
            .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await advanceBlocksAsync(derivadex.providerEngine, 2);
        await derivadex.castVote(8, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await derivadex.queue(8).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        await advanceBlocksAsync(derivadex.providerEngine, 1);
        await derivadex.execute(8).awaitTransactionSuccessAsync({ from: fixtures.traderB(), gas: 9000000 });
    });

    it('Successfully adds HUSD collateral', async () => {
        const targets = [derivadex.derivaDEXContract.address];
        const values = [0];
        const signatures = [derivadex.insuranceFundContract.getFunctionSignature('addInsuranceFundCollateral')];
        const calldatas = [
            generateCallData(
                derivadex
                    .addInsuranceFundCollateral(
                        HUSD.collateralName,
                        HUSD.collateralSymbol,
                        ZERO_ADDRESS,
                        HUSD.collateralAddress,
                        HUSD.collateralStakingType,
                    )
                    .getABIEncodedTransactionData(),
            ),
        ];
        const description = 'Add HUSD.';
        await derivadex
            .propose(targets, values, signatures, calldatas, description)
            .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await advanceBlocksAsync(derivadex.providerEngine, 2);
        await derivadex.castVote(9, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await derivadex.queue(9).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        await advanceBlocksAsync(derivadex.providerEngine, 1);
        await derivadex.execute(9).awaitTransactionSuccessAsync({ from: fixtures.traderB(), gas: 7000000 });
    });

    it('Successfully changes timelock delay', async () => {
        let governanceInfo = await derivadex.getGovernanceParametersAsync();
        expect(governanceInfo.timelockDelay).to.be.bignumber.eq(0);

        const targets = [derivadex.derivaDEXContract.address];
        const values = [0];
        const signatures = [derivadex.governanceContract.getFunctionSignature('setTimelockDelay')];
        const calldatas = [generateCallData(derivadex.setTimelockDelay(259200).getABIEncodedTransactionData())];
        const description = 'Set timelock delay.';
        await derivadex
            .propose(targets, values, signatures, calldatas, description)
            .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await advanceBlocksAsync(derivadex.providerEngine, 2);
        await derivadex.castVote(10, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await derivadex.queue(10).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        await advanceBlocksAsync(derivadex.providerEngine, 1);
        await derivadex.execute(10).awaitTransactionSuccessAsync({ from: fixtures.traderB(), gas: 7000000 });

        governanceInfo = await derivadex.getGovernanceParametersAsync();
        expect(governanceInfo.timelockDelay).to.be.bignumber.eq(259200);
    });

    it('Fails to add GUSD collateral with insufficient queue delay', async () => {
        const targets = [derivadex.derivaDEXContract.address];
        const values = [0];
        const signatures = [derivadex.insuranceFundContract.getFunctionSignature('addInsuranceFundCollateral')];
        const calldatas = [
            generateCallData(
                derivadex
                    .addInsuranceFundCollateral(
                        GUSD.collateralName,
                        GUSD.collateralSymbol,
                        ZERO_ADDRESS,
                        GUSD.collateralAddress,
                        GUSD.collateralStakingType,
                    )
                    .getABIEncodedTransactionData(),
            ),
        ];
        const description = 'Add GUSD.';
        await derivadex
            .propose(targets, values, signatures, calldatas, description)
            .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await advanceBlocksAsync(derivadex.providerEngine, 2);
        await derivadex.castVote(11, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await derivadex.queue(11).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        await advanceBlocksAsync(derivadex.providerEngine, 1);
        await expect(
            derivadex.execute(11).awaitTransactionSuccessAsync({ from: fixtures.traderB(), gas: 7000000 }),
        ).to.be.rejectedWith("Governance: proposal hasn't finished queue time length.");
    });

    it('Successfully adds GUSD collateral', async () => {
        const targets = [derivadex.derivaDEXContract.address];
        const values = [0];
        const signatures = [derivadex.insuranceFundContract.getFunctionSignature('addInsuranceFundCollateral')];
        const calldatas = [
            generateCallData(
                derivadex
                    .addInsuranceFundCollateral(
                        GUSD.collateralName,
                        GUSD.collateralSymbol,
                        ZERO_ADDRESS,
                        GUSD.collateralAddress,
                        GUSD.collateralStakingType,
                    )
                    .getABIEncodedTransactionData(),
            ),
        ];
        const description = 'Add GUSD.';
        await derivadex
            .propose(targets, values, signatures, calldatas, description)
            .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await advanceBlocksAsync(derivadex.providerEngine, 2);
        await derivadex.castVote(12, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await derivadex.queue(12).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        await advanceTimeAsync(derivadex.providerEngine, 259200);
        await advanceBlocksAsync(derivadex.providerEngine, 1);
        await derivadex.execute(12).awaitTransactionSuccessAsync({ from: fixtures.traderB(), gas: 7000000 });
    });

    it('checks supported collateral names have been added and addresses and flavors', async () => {
        const collateralNames = (await derivadex.getInsuranceMineInfoAsync()).collateralNames;
        expect(collateralNames).to.deep.eq([
            USDT.collateralName,
            CUSDT.collateralName,
            AUSDT.collateralName,
            HUSD.collateralName,
            GUSD.collateralName,
        ]);

        // Get addresses (collateral, underlying, and diFund tokens) and flavor
        const addressAndFlavorUSDT = await derivadex.getStakeCollateralByCollateralNameAsync(USDT.collateralName);
        expect(addressAndFlavorUSDT.collateralToken).to.eq(USDT.collateralAddress);
        expect(addressAndFlavorUSDT.underlyingToken).to.eq(ZERO_ADDRESS);
        expect(addressAndFlavorUSDT.diFundToken).to.not.eq(ZERO_ADDRESS);
        expect(addressAndFlavorUSDT.cap).to.be.bignumber.eq(0);
        expect(addressAndFlavorUSDT.withdrawalFeeCap).to.be.bignumber.eq(0);
        expect(addressAndFlavorUSDT.flavor).to.eq(StakeFlavor.Vanilla);

        const addressAndFlavorCUSDT = await derivadex.getStakeCollateralByCollateralNameAsync(CUSDT.collateralName);
        expect(addressAndFlavorCUSDT.collateralToken).to.eq(CUSDT.collateralAddress);
        expect(addressAndFlavorCUSDT.underlyingToken).to.eq(USDT.collateralAddress);
        expect(addressAndFlavorCUSDT.diFundToken).to.not.eq(ZERO_ADDRESS);
        expect(addressAndFlavorCUSDT.cap).to.be.bignumber.eq(0);
        expect(addressAndFlavorCUSDT.withdrawalFeeCap).to.be.bignumber.eq(0);
        expect(addressAndFlavorCUSDT.flavor).to.eq(StakeFlavor.Compound);

        const addressAndFlavorAUSDT = await derivadex.getStakeCollateralByCollateralNameAsync(AUSDT.collateralName);
        expect(addressAndFlavorAUSDT.collateralToken).to.eq(AUSDT.collateralAddress);
        expect(addressAndFlavorAUSDT.underlyingToken).to.eq(USDT.collateralAddress);
        expect(addressAndFlavorAUSDT.diFundToken).to.not.eq(ZERO_ADDRESS);
        expect(addressAndFlavorAUSDT.cap).to.be.bignumber.eq(0);
        expect(addressAndFlavorAUSDT.withdrawalFeeCap).to.be.bignumber.eq(0);
        expect(addressAndFlavorAUSDT.flavor).to.eq(StakeFlavor.Aave);

        const addressAndFlavorHUSD = await derivadex.getStakeCollateralByCollateralNameAsync(HUSD.collateralName);
        expect(addressAndFlavorHUSD.collateralToken).to.eq(HUSD.collateralAddress);
        expect(addressAndFlavorHUSD.underlyingToken).to.eq(ZERO_ADDRESS);
        expect(addressAndFlavorHUSD.diFundToken).to.not.eq(ZERO_ADDRESS);
        expect(addressAndFlavorHUSD.cap).to.be.bignumber.eq(0);
        expect(addressAndFlavorHUSD.withdrawalFeeCap).to.be.bignumber.eq(0);
        expect(addressAndFlavorHUSD.flavor).to.eq(StakeFlavor.Vanilla);

        const addressAndFlavorGUSD = await derivadex.getStakeCollateralByCollateralNameAsync(GUSD.collateralName);
        expect(addressAndFlavorGUSD.collateralToken).to.eq(GUSD.collateralAddress);
        expect(addressAndFlavorGUSD.underlyingToken).to.eq(ZERO_ADDRESS);
        expect(addressAndFlavorGUSD.diFundToken).to.not.eq(ZERO_ADDRESS);
        expect(addressAndFlavorGUSD.cap).to.be.bignumber.eq(0);
        expect(addressAndFlavorGUSD.withdrawalFeeCap).to.be.bignumber.eq(0);
        expect(addressAndFlavorGUSD.flavor).to.eq(StakeFlavor.Vanilla);
    });

    it('fails to stake 0 USDT', async () => {
        // Staking Trader A
        await expect(
            derivadex
                .stakeToInsuranceFund(USDT.collateralName, 0)
                .awaitTransactionSuccessAsync({ from: fixtures.traderA() }),
        ).to.be.rejectedWith('IFund: non-zero amount.');
    });

    let cusdtToUSDTAmount;
    it('Trader A - stakes USDT and cUSDT in the first interval', async () => {
        // Make approvals for trader A to stake USDT and cUSDT
        await derivadex
            .approveForStakeToInsuranceFund(USDT.collateralAddress)
            .awaitTransactionSuccessAsync({ from: fixtures.traderA() });
        await derivadex
            .approveForStakeToInsuranceFund(CUSDT.collateralAddress)
            .awaitTransactionSuccessAsync({ from: fixtures.traderA() });

        // Get insurance mine info
        let insuranceMineInfoA = await derivadex.getInsuranceMineInfoAsync();
        expect(insuranceMineInfoA.minedAmount).to.be.bignumber.eq(0);
        expect(insuranceMineInfoA.mineRatePerBlock).to.be.bignumber.eq(1.189117199391172);
        expect(insuranceMineInfoA.interval).to.be.bignumber.eq(50);

        // Pre claiming data
        const traderABalancePreClaim = await derivadex.getBalanceOfDDXAsync(fixtures.traderA());
        let traderAAttributes = await derivadex.getTraderAsync(fixtures.traderA());
        expect(traderAAttributes.ddxWalletContract).to.eq(ZERO_ADDRESS);

        let unclaimedLocalCurrentA = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderA(),
            new BigNumber(0),
            new BigNumber(0),
        );
        let unclaimedLocalNextA = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderA(),
            new BigNumber(0),
            new BigNumber(0),
            false,
        );
        let unclaimedDDXRewardsA = await derivadex.getUnclaimedDDXRewardsAsync(fixtures.traderA());
        expect(unclaimedLocalCurrentA.dp(2)).to.be.bignumber.eq(0);
        expect(unclaimedLocalNextA.dp(2)).to.be.bignumber.eq(0);
        expect(unclaimedDDXRewardsA.dp(2)).to.be.bignumber.eq(0);
        expect(unclaimedLocalCurrentA.dp(2)).to.be.bignumber.eq(unclaimedDDXRewardsA.dp(2));

        // Stake to insurance fund
        await derivadex
            .stakeToInsuranceFund(USDT.collateralName, 1000)
            .awaitTransactionSuccessAsync({ from: fixtures.traderA() });

        unclaimedLocalCurrentA = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderA(),
            new BigNumber(1000000000),
            new BigNumber(1000000000),
        );
        unclaimedLocalNextA = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderA(),
            new BigNumber(1000000000),
            new BigNumber(1000000000),
            false,
        );
        unclaimedDDXRewardsA = await derivadex.getUnclaimedDDXRewardsAsync(fixtures.traderA());
        expect(unclaimedLocalCurrentA.dp(2)).to.be.bignumber.eq(unclaimedDDXRewardsA.dp(2));

        // await derivadex.getCOMPOwedAsync(fixtures.traderA(), CUSDT.collateralAddress);

        await derivadex
            .stakeToInsuranceFund(CUSDT.collateralName, 500)
            .awaitTransactionSuccessAsync({ from: fixtures.traderA() });

        insuranceMineInfoA = await derivadex.getInsuranceMineInfoAsync();
        expect(insuranceMineInfoA.minedAmount.dp(2)).to.be.bignumber.eq(unclaimedLocalNextA.dp(2));

        const traderABalancePostClaim = await derivadex.getBalanceOfDDXAsync(fixtures.traderA());
        expect(traderABalancePostClaim.minus(traderABalancePreClaim).dp(2)).to.be.bignumber.eq(0);
        traderAAttributes = await derivadex.getTraderAsync(fixtures.traderA());
        const traderAWalletBalancePostClaim = await derivadex.getBalanceOfDDXAsync(traderAAttributes.ddxWalletContract);
        expect(traderAWalletBalancePostClaim.dp(2)).to.be.bignumber.eq(unclaimedLocalNextA.dp(2));
        expect(traderAWalletBalancePostClaim.dp(2)).to.be.bignumber.eq(traderAAttributes.ddxBalance.dp(2));

        await advanceBlocksAsync(derivadex.providerEngine, 1);

        // Get addresses (collateral, underlying, and diFund tokens) and flavor
        const stakeCollateralUSDT = await derivadex.getStakeCollateralByCollateralNameAsync(USDT.collateralName);
        const stakeCollateralCUSDT = await derivadex.getStakeCollateralByCollateralNameAsync(CUSDT.collateralName);

        expect(stakeCollateralUSDT.cap).to.be.bignumber.eq(1000);
        expect(stakeCollateralUSDT.withdrawalFeeCap).to.be.bignumber.eq(0);

        cusdtToUSDTAmount = await derivadex.getUSDTFromCUSDTAsync(CUSDT.collateralAddress, 500);
        expect(stakeCollateralCUSDT.cap).to.be.bignumber.eq(500);
        expect(stakeCollateralCUSDT.withdrawalFeeCap).to.be.bignumber.eq(0);

        // Get current stake details for Trader A and USDT
        const currentStakeByCollateralNameAndStakerAUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            USDT.collateralName,
            fixtures.traderA(),
        );
        expect(currentStakeByCollateralNameAndStakerAUSDT.stakerStake).to.be.bignumber.eq(1000);
        expect(currentStakeByCollateralNameAndStakerAUSDT.globalCap).to.be.bignumber.eq(1000);
        expect(currentStakeByCollateralNameAndStakerAUSDT.normalizedStakerStake).to.be.bignumber.eq(1000);
        expect(currentStakeByCollateralNameAndStakerAUSDT.normalizedGlobalCap).to.be.bignumber.eq(1000);

        // Get current stake details for Trader A and cUSDT
        const currentStakeByCollateralNameAndStakerACUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            CUSDT.collateralName,
            fixtures.traderA(),
        );
        expect(currentStakeByCollateralNameAndStakerACUSDT.stakerStake).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerACUSDT.globalCap).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerACUSDT.normalizedStakerStake.dp(2)).to.be.bignumber.eq(
            cusdtToUSDTAmount.dp(2),
        );
        expect(currentStakeByCollateralNameAndStakerACUSDT.normalizedGlobalCap.dp(2)).to.be.bignumber.eq(
            cusdtToUSDTAmount.dp(2),
        );

        const currentTotalStakesA = await derivadex.getCurrentTotalStakesAsync(fixtures.traderA());
        expect(currentTotalStakesA.normalizedStakerStakeSum.dp(2)).to.be.bignumber.eq(
            new BigNumber(1000).plus(cusdtToUSDTAmount).dp(2),
        );
        expect(currentTotalStakesA.normalizedGlobalCapSum.dp(2)).to.be.bignumber.eq(
            new BigNumber(1000).plus(cusdtToUSDTAmount).dp(2),
        );
    });

    it('Trader B - stakes USDT in the first interval', async () => {
        // Make approvals for trader B to stake USDT and cUSDT
        await derivadex
            .approveForStakeToInsuranceFund(USDT.collateralAddress)
            .awaitTransactionSuccessAsync({ from: fixtures.traderB() });

        // Stake to insurance fund
        await derivadex
            .stakeToInsuranceFund(USDT.collateralName, 500)
            .awaitTransactionSuccessAsync({ from: fixtures.traderB() });

        await advanceBlocksAsync(derivadex.providerEngine, 1);

        // Get addresses (collateral, underlying, and diFund tokens) and flavor
        const stakeCollateralUSDT = await derivadex.getStakeCollateralByCollateralNameAsync(USDT.collateralName);
        const stakeCollateralCUSDT = await derivadex.getStakeCollateralByCollateralNameAsync(CUSDT.collateralName);

        expect(stakeCollateralUSDT.cap).to.be.bignumber.eq(1500);
        expect(stakeCollateralUSDT.withdrawalFeeCap).to.be.bignumber.eq(0);

        cusdtToUSDTAmount = await derivadex.getUSDTFromCUSDTAsync(CUSDT.collateralAddress, 500);
        expect(stakeCollateralCUSDT.cap).to.be.bignumber.eq(500);
        expect(stakeCollateralCUSDT.withdrawalFeeCap).to.be.bignumber.eq(0);

        // Get current stake details for Trader A and USDT
        const currentStakeByCollateralNameAndStakerAUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            USDT.collateralName,
            fixtures.traderA(),
        );
        expect(currentStakeByCollateralNameAndStakerAUSDT.stakerStake).to.be.bignumber.eq(1000);
        expect(currentStakeByCollateralNameAndStakerAUSDT.globalCap).to.be.bignumber.eq(1500);
        expect(currentStakeByCollateralNameAndStakerAUSDT.normalizedStakerStake).to.be.bignumber.eq(1000);
        expect(currentStakeByCollateralNameAndStakerAUSDT.normalizedGlobalCap).to.be.bignumber.eq(1500);

        // Get current stake details for Trader A and cUSDT
        const currentStakeByCollateralNameAndStakerACUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            CUSDT.collateralName,
            fixtures.traderA(),
        );
        expect(currentStakeByCollateralNameAndStakerACUSDT.stakerStake).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerACUSDT.globalCap).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerACUSDT.normalizedStakerStake.dp(2)).to.be.bignumber.eq(
            cusdtToUSDTAmount.dp(2),
        );
        expect(currentStakeByCollateralNameAndStakerACUSDT.normalizedGlobalCap.dp(2)).to.be.bignumber.eq(
            cusdtToUSDTAmount.dp(2),
        );

        // Get current stake details for Trader B and USDT
        const currentStakeByCollateralNameAndStakerBUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            USDT.collateralName,
            fixtures.traderB(),
        );
        expect(currentStakeByCollateralNameAndStakerBUSDT.stakerStake).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerBUSDT.globalCap).to.be.bignumber.eq(1500);
        expect(currentStakeByCollateralNameAndStakerBUSDT.normalizedStakerStake).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerBUSDT.normalizedGlobalCap).to.be.bignumber.eq(1500);

        // Get current stake details for Trader B and cUSDT
        const currentStakeByCollateralNameAndStakerBCUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            CUSDT.collateralName,
            fixtures.traderB(),
        );
        expect(currentStakeByCollateralNameAndStakerBCUSDT.stakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerBCUSDT.globalCap).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerBCUSDT.normalizedStakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerBCUSDT.normalizedGlobalCap.dp(2)).to.be.bignumber.eq(
            cusdtToUSDTAmount.dp(2),
        );

        const currentTotalStakesA = await derivadex.getCurrentTotalStakesAsync(fixtures.traderA());
        expect(currentTotalStakesA.normalizedStakerStakeSum.dp(2)).to.be.bignumber.eq(
            new BigNumber(1000).plus(cusdtToUSDTAmount).dp(2),
        );
        expect(currentTotalStakesA.normalizedGlobalCapSum.dp(2)).to.be.bignumber.eq(
            new BigNumber(1500).plus(cusdtToUSDTAmount).dp(2),
        );

        const currentTotalStakesB = await derivadex.getCurrentTotalStakesAsync(fixtures.traderB());
        expect(currentTotalStakesB.normalizedStakerStakeSum).to.be.bignumber.eq(500);
        expect(currentTotalStakesB.normalizedGlobalCapSum.dp(2)).to.be.bignumber.eq(
            new BigNumber(1500).plus(cusdtToUSDTAmount).dp(2),
        );
    });

    it('distributes DDX to insurance miner A', async () => {
        await advanceBlocksAsync(derivadex.providerEngine, 50);

        const initCompDDX = await derivadex.getCOMPBalanceAsync(derivadex.derivaDEXContract.address);
        await derivadex.advanceOtherRewardsInterval().awaitTransactionSuccessAsync({ from: fixtures.traderA() });
        const finCompDDX = await derivadex.getCOMPBalanceAsync(derivadex.derivaDEXContract.address);

        expect(initCompDDX).to.be.bignumber.eq(0);
        expect(finCompDDX.gt(0)).to.eq(true);

        // Pre claiming data
        const traderABalancePreClaim = await derivadex.getBalanceOfDDXAsync(fixtures.traderA());
        let traderAAttributes = await derivadex.getTraderAsync(fixtures.traderA());
        expect(traderAAttributes.ddxWalletContract).to.not.eq(ZERO_ADDRESS);
        const traderAWalletBalancePreClaim = await derivadex.getBalanceOfDDXAsync(traderAAttributes.ddxWalletContract);
        expect(traderAWalletBalancePreClaim).to.be.bignumber.eq(traderAAttributes.ddxBalance);

        const cusdtToUSDTTokenAmount = await derivadex.getUSDTTokensFromCUSDTAsync(
            CUSDT.collateralAddress,
            50000000000,
        );
        const unclaimedLocalCurrentA = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderA(),
            new BigNumber(1500000000).plus(cusdtToUSDTTokenAmount),
            new BigNumber(1000000000).plus(cusdtToUSDTTokenAmount),
        );
        const unclaimedLocalNextA = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderA(),
            new BigNumber(1500000000).plus(cusdtToUSDTTokenAmount),
            new BigNumber(1000000000).plus(cusdtToUSDTTokenAmount),
            false,
        );
        const unclaimedDDXRewardsA = await derivadex.getUnclaimedDDXRewardsAsync(fixtures.traderA());
        expect(unclaimedLocalCurrentA.dp(2)).to.be.bignumber.eq(unclaimedDDXRewardsA.dp(2));

        const initInsuranceMineInfoA = await derivadex.getInsuranceMineInfoAsync();
        const initCompA = await derivadex.getCOMPBalanceAsync(fixtures.traderA());
        await derivadex
            .claimDDXFromInsuranceMining(fixtures.traderA())
            .awaitTransactionSuccessAsync({ from: fixtures.traderA() });
        const finCompA = await derivadex.getCOMPBalanceAsync(fixtures.traderA());

        expect(initCompA).to.be.bignumber.eq(0);
        expect(finCompA.gt(0)).to.eq(true);
        expect(finCompA).to.be.bignumber.eq(finCompDDX);

        const insuranceMineInfoA = await derivadex.getInsuranceMineInfoAsync();
        expect(insuranceMineInfoA.minedAmount.dp(2)).to.be.bignumber.eq(
            initInsuranceMineInfoA.minedAmount.plus(unclaimedLocalNextA).dp(2),
        );

        const traderABalancePostClaim = await derivadex.getBalanceOfDDXAsync(fixtures.traderA());
        expect(traderABalancePostClaim.minus(traderABalancePreClaim).dp(2)).to.be.bignumber.eq(0);
        traderAAttributes = await derivadex.getTraderAsync(fixtures.traderA());
        const traderAWalletBalancePostClaim = await derivadex.getBalanceOfDDXAsync(traderAAttributes.ddxWalletContract);
        expect(traderAWalletBalancePostClaim).to.be.bignumber.eq(traderAAttributes.ddxBalance);
        expect(traderAWalletBalancePostClaim.dp(2)).to.be.bignumber.eq(
            traderAWalletBalancePreClaim.plus(unclaimedLocalNextA).dp(2),
        );
        expect(traderAWalletBalancePostClaim.dp(2)).to.be.bignumber.eq(traderAAttributes.ddxBalance.dp(2));
    });

    it('distributes DDX to insurance miner B', async () => {
        const traderBBalancePreClaim = await derivadex.getBalanceOfDDXAsync(fixtures.traderB());
        let traderBAttributes = await derivadex.getTraderAsync(fixtures.traderB());
        expect(traderBAttributes.ddxWalletContract).to.eq(ZERO_ADDRESS);
        const traderBWalletBalancePreClaim = new BigNumber(0);

        const cusdtToUSDTTokenAmount = await derivadex.getUSDTTokensFromCUSDTAsync(
            CUSDT.collateralAddress,
            50000000000,
        );
        const unclaimedLocalCurrentB = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderB(),
            new BigNumber(1500000000).plus(cusdtToUSDTTokenAmount),
            new BigNumber(500000000),
        );
        const unclaimedLocalNextB = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderB(),
            new BigNumber(1500000000).plus(cusdtToUSDTTokenAmount),
            new BigNumber(500000000),
            false,
        );
        const unclaimedDDXRewardsB = await derivadex.getUnclaimedDDXRewardsAsync(fixtures.traderB());
        expect(unclaimedLocalCurrentB.dp(2)).to.be.bignumber.eq(unclaimedDDXRewardsB.dp(2));

        // cusdtToUSDTAmount = await derivadex.getUSDTFromCUSDTAsync(CUSDT.collateralAddress, 500);

        const initInsuranceMineInfoB = await derivadex.getInsuranceMineInfoAsync();
        await derivadex
            .claimDDXFromInsuranceMining(fixtures.traderB())
            .awaitTransactionSuccessAsync({ from: fixtures.traderB() });

        const insuranceMineInfoB = await derivadex.getInsuranceMineInfoAsync();
        expect(insuranceMineInfoB.minedAmount.dp(2)).to.be.bignumber.eq(
            initInsuranceMineInfoB.minedAmount.plus(unclaimedLocalNextB).dp(2),
        );

        const traderBBalancePostClaim = await derivadex.getBalanceOfDDXAsync(fixtures.traderB());
        expect(traderBBalancePostClaim.minus(traderBBalancePreClaim).dp(2)).to.be.bignumber.eq(0);
        traderBAttributes = await derivadex.getTraderAsync(fixtures.traderB());
        const traderBWalletBalancePostClaim = await derivadex.getBalanceOfDDXAsync(traderBAttributes.ddxWalletContract);
        expect(traderBWalletBalancePostClaim).to.be.bignumber.eq(traderBAttributes.ddxBalance);

        expect(traderBWalletBalancePostClaim.dp(2)).to.be.bignumber.eq(
            traderBWalletBalancePreClaim.plus(unclaimedLocalNextB).dp(2),
        );
        expect(traderBWalletBalancePostClaim.dp(2)).to.be.bignumber.eq(traderBAttributes.ddxBalance.dp(2));
    });

    it('Trader A - stakes USDT in the second interval', async () => {
        // Staking Trader A
        // Stake USDT
        await derivadex
            .stakeToInsuranceFund(USDT.collateralName, 5000)
            .awaitTransactionSuccessAsync({ from: fixtures.traderA() });
        await advanceBlocksAsync(derivadex.providerEngine, 1);

        const insuranceMineInfoA = await derivadex.getInsuranceMineInfoAsync();
        expect(insuranceMineInfoA.interval).to.be.bignumber.eq(50);

        // Get addresses (collateral, underlying, and diFund tokens) and flavor
        const stakeCollateralUSDT = await derivadex.getStakeCollateralByCollateralNameAsync(USDT.collateralName);
        const stakeCollateralCUSDT = await derivadex.getStakeCollateralByCollateralNameAsync(CUSDT.collateralName);

        expect(stakeCollateralUSDT.cap).to.be.bignumber.eq(6500);
        expect(stakeCollateralUSDT.withdrawalFeeCap).to.be.bignumber.eq(0);

        cusdtToUSDTAmount = await derivadex.getUSDTFromCUSDTAsync(CUSDT.collateralAddress, 500);
        expect(stakeCollateralCUSDT.cap).to.be.bignumber.eq(500);
        expect(stakeCollateralCUSDT.withdrawalFeeCap).to.be.bignumber.eq(0);

        // **********
        // Get current stake details for Trader A and USDT
        const currentStakeByCollateralNameAndStakerAUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            USDT.collateralName,
            fixtures.traderA(),
        );
        expect(currentStakeByCollateralNameAndStakerAUSDT.stakerStake).to.be.bignumber.eq(6000);
        expect(currentStakeByCollateralNameAndStakerAUSDT.globalCap).to.be.bignumber.eq(6500);
        expect(currentStakeByCollateralNameAndStakerAUSDT.normalizedStakerStake).to.be.bignumber.eq(6000);
        expect(currentStakeByCollateralNameAndStakerAUSDT.normalizedGlobalCap).to.be.bignumber.eq(6500);

        cusdtToUSDTAmount = await derivadex.getUSDTFromCUSDTAsync(CUSDT.collateralAddress, 500);

        // Get current stake details for Trader A and cUSDT
        const currentStakeByCollateralNameAndStakerACUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            CUSDT.collateralName,
            fixtures.traderA(),
        );
        expect(currentStakeByCollateralNameAndStakerACUSDT.stakerStake).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerACUSDT.globalCap).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerACUSDT.normalizedStakerStake.dp(2)).to.be.bignumber.eq(
            cusdtToUSDTAmount.dp(2),
        );
        expect(currentStakeByCollateralNameAndStakerACUSDT.normalizedGlobalCap.dp(2)).to.be.bignumber.eq(
            cusdtToUSDTAmount.dp(2),
        );

        // Get current stake details for Trader B and USDT
        const currentStakeByCollateralNameAndStakerBUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            USDT.collateralName,
            fixtures.traderB(),
        );
        expect(currentStakeByCollateralNameAndStakerBUSDT.stakerStake).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerBUSDT.globalCap).to.be.bignumber.eq(6500);
        expect(currentStakeByCollateralNameAndStakerBUSDT.normalizedStakerStake).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerBUSDT.normalizedGlobalCap).to.be.bignumber.eq(6500);

        // Get current stake details for Trader B and cUSDT
        const currentStakeByCollateralNameAndStakerBCUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            CUSDT.collateralName,
            fixtures.traderB(),
        );
        expect(currentStakeByCollateralNameAndStakerBCUSDT.stakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerBCUSDT.globalCap).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerBCUSDT.normalizedStakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerBCUSDT.normalizedGlobalCap.dp(2)).to.be.bignumber.eq(
            cusdtToUSDTAmount.dp(2),
        );

        const currentTotalStakesA = await derivadex.getCurrentTotalStakesAsync(fixtures.traderA());
        expect(currentTotalStakesA.normalizedStakerStakeSum.dp(2)).to.be.bignumber.eq(
            new BigNumber(6000).plus(cusdtToUSDTAmount).dp(2),
        );
        expect(currentTotalStakesA.normalizedGlobalCapSum.dp(2)).to.be.bignumber.eq(
            new BigNumber(6500).plus(cusdtToUSDTAmount).dp(2),
        );

        const currentTotalStakesB = await derivadex.getCurrentTotalStakesAsync(fixtures.traderB());
        expect(currentTotalStakesB.normalizedStakerStakeSum).to.be.bignumber.eq(500);
        expect(currentTotalStakesB.normalizedGlobalCapSum.dp(2)).to.be.bignumber.eq(
            new BigNumber(6500).plus(cusdtToUSDTAmount).dp(2),
        );
    });

    it('Trader C - stakes AUSDT in the second interval', async () => {
        await derivadex
            .approveForStakeToInsuranceFund(AUSDT.collateralAddress)
            .awaitTransactionSuccessAsync({ from: fixtures.traderC() });
        await derivadex
            .stakeToInsuranceFund(AUSDT.collateralName, 2500)
            .awaitTransactionSuccessAsync({ from: fixtures.traderC() });
        await advanceBlocksAsync(derivadex.providerEngine, 1);

        const insuranceMineInfo = await derivadex.getInsuranceMineInfoAsync();
        expect(insuranceMineInfo.interval).to.be.bignumber.eq(50);

        const stakeCollateralAUSDT = await derivadex.getStakeCollateralByCollateralNameAsync(AUSDT.collateralName);
        expect(stakeCollateralAUSDT.cap).to.be.bignumber.eq(2500);
        expect(stakeCollateralAUSDT.withdrawalFeeCap).to.be.bignumber.eq(0);

        // **********
        // Get current stake details for Trader A and USDT
        const currentStakeByCollateralNameAndStakerAUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            USDT.collateralName,
            fixtures.traderA(),
        );
        expect(currentStakeByCollateralNameAndStakerAUSDT.stakerStake).to.be.bignumber.eq(6000);
        expect(currentStakeByCollateralNameAndStakerAUSDT.globalCap).to.be.bignumber.eq(6500);
        expect(currentStakeByCollateralNameAndStakerAUSDT.normalizedStakerStake).to.be.bignumber.eq(6000);
        expect(currentStakeByCollateralNameAndStakerAUSDT.normalizedGlobalCap).to.be.bignumber.eq(6500);

        cusdtToUSDTAmount = await derivadex.getUSDTFromCUSDTAsync(CUSDT.collateralAddress, 500);

        // Get current stake details for Trader A and cUSDT
        const currentStakeByCollateralNameAndStakerACUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            CUSDT.collateralName,
            fixtures.traderA(),
        );
        expect(currentStakeByCollateralNameAndStakerACUSDT.stakerStake).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerACUSDT.globalCap).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerACUSDT.normalizedStakerStake.dp(2)).to.be.bignumber.eq(
            cusdtToUSDTAmount.dp(2),
        );
        expect(currentStakeByCollateralNameAndStakerACUSDT.normalizedGlobalCap.dp(2)).to.be.bignumber.eq(
            cusdtToUSDTAmount.dp(2),
        );

        // Get current stake details for Trader A and aUSDT
        const currentStakeByCollateralNameAndStakerAAUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            AUSDT.collateralName,
            fixtures.traderA(),
        );
        expect(currentStakeByCollateralNameAndStakerAAUSDT.stakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerAAUSDT.globalCap).to.be.bignumber.eq(2500);
        expect(currentStakeByCollateralNameAndStakerAAUSDT.normalizedStakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerAAUSDT.normalizedGlobalCap).to.be.bignumber.eq(2500);

        // Get current stake details for Trader B and USDT
        const currentStakeByCollateralNameAndStakerBUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            USDT.collateralName,
            fixtures.traderB(),
        );
        expect(currentStakeByCollateralNameAndStakerBUSDT.stakerStake).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerBUSDT.globalCap).to.be.bignumber.eq(6500);
        expect(currentStakeByCollateralNameAndStakerBUSDT.normalizedStakerStake).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerBUSDT.normalizedGlobalCap).to.be.bignumber.eq(6500);

        // Get current stake details for Trader B and cUSDT
        const currentStakeByCollateralNameAndStakerBCUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            CUSDT.collateralName,
            fixtures.traderB(),
        );
        expect(currentStakeByCollateralNameAndStakerBCUSDT.stakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerBCUSDT.globalCap).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerBCUSDT.normalizedStakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerBCUSDT.normalizedGlobalCap.dp(2)).to.be.bignumber.eq(
            cusdtToUSDTAmount.dp(2),
        );

        // Get current stake details for Trader B and aUSDT
        const currentStakeByCollateralNameAndStakerBAUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            AUSDT.collateralName,
            fixtures.traderB(),
        );
        expect(currentStakeByCollateralNameAndStakerBAUSDT.stakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerBAUSDT.globalCap).to.be.bignumber.eq(2500);
        expect(currentStakeByCollateralNameAndStakerBAUSDT.normalizedStakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerBAUSDT.normalizedGlobalCap).to.be.bignumber.eq(2500);

        // Get current stake details for Trader C and USDT
        const currentStakeByCollateralNameAndStakerCUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            USDT.collateralName,
            fixtures.traderC(),
        );
        expect(currentStakeByCollateralNameAndStakerCUSDT.stakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerCUSDT.globalCap).to.be.bignumber.eq(6500);
        expect(currentStakeByCollateralNameAndStakerCUSDT.normalizedStakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerCUSDT.normalizedGlobalCap).to.be.bignumber.eq(6500);

        // Get current stake details for Trader C and cUSDT
        const currentStakeByCollateralNameAndStakerCCUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            CUSDT.collateralName,
            fixtures.traderC(),
        );
        expect(currentStakeByCollateralNameAndStakerCCUSDT.stakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerCCUSDT.globalCap).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerCCUSDT.normalizedStakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerCCUSDT.normalizedGlobalCap.dp(2)).to.be.bignumber.eq(
            cusdtToUSDTAmount.dp(2),
        );

        // Get current stake details for Trader C and aUSDT
        const currentStakeByCollateralNameAndStakerCAUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            AUSDT.collateralName,
            fixtures.traderC(),
        );
        expect(currentStakeByCollateralNameAndStakerCAUSDT.stakerStake).to.be.bignumber.eq(2500);
        expect(currentStakeByCollateralNameAndStakerCAUSDT.globalCap).to.be.bignumber.eq(2500);
        expect(currentStakeByCollateralNameAndStakerCAUSDT.normalizedStakerStake).to.be.bignumber.eq(2500);
        expect(currentStakeByCollateralNameAndStakerCAUSDT.normalizedGlobalCap).to.be.bignumber.eq(2500);

        const currentTotalStakesA = await derivadex.getCurrentTotalStakesAsync(fixtures.traderA());
        expect(currentTotalStakesA.normalizedStakerStakeSum.dp(2)).to.be.bignumber.eq(
            new BigNumber(6000).plus(cusdtToUSDTAmount).dp(2),
        );
        expect(currentTotalStakesA.normalizedGlobalCapSum.dp(2)).to.be.bignumber.eq(
            new BigNumber(9000).plus(cusdtToUSDTAmount).dp(2),
        );

        const currentTotalStakesB = await derivadex.getCurrentTotalStakesAsync(fixtures.traderB());
        expect(currentTotalStakesB.normalizedStakerStakeSum).to.be.bignumber.eq(500);
        expect(currentTotalStakesB.normalizedGlobalCapSum.dp(2)).to.be.bignumber.eq(
            new BigNumber(9000).plus(cusdtToUSDTAmount).dp(2),
        );

        const currentTotalStakesC = await derivadex.getCurrentTotalStakesAsync(fixtures.traderC());
        expect(currentTotalStakesC.normalizedStakerStakeSum).to.be.bignumber.eq(2500);
        expect(currentTotalStakesC.normalizedGlobalCapSum.dp(2)).to.be.bignumber.eq(
            new BigNumber(9000).plus(cusdtToUSDTAmount).dp(2),
        );
    });

    it('fails to withdraw 0 USDT', async () => {
        // Staking Trader A
        await expect(
            derivadex
                .withdrawFromInsuranceFund(USDT.collateralName, 0)
                .awaitTransactionSuccessAsync({ from: fixtures.traderA() }),
        ).to.be.rejectedWith('IFund: non-zero amount.');
    });

    let unclaimedLocalCurrentA2: BigNumber;
    let unclaimedLocalCurrentB2: BigNumber;
    let unclaimedLocalCurrentC2: BigNumber;
    it('claims a couple times for Traders A, B, C', async () => {
        await derivadex
            .claimDDXFromInsuranceMining(fixtures.traderA())
            .awaitTransactionSuccessAsync({ from: fixtures.traderA() });
        await derivadex
            .claimDDXFromInsuranceMining(fixtures.traderB())
            .awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        await derivadex
            .claimDDXFromInsuranceMining(fixtures.traderC())
            .awaitTransactionSuccessAsync({ from: fixtures.traderC() });

        await advanceBlocksAsync(derivadex.providerEngine, 10);

        const cusdtToUSDTTokenAmount = await derivadex.getUSDTTokensFromCUSDTAsync(
            CUSDT.collateralAddress,
            50000000000,
        );
        const unclaimedLocalCurrentA1 = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderA(),
            new BigNumber(9000000000).plus(cusdtToUSDTTokenAmount),
            new BigNumber(6000000000).plus(cusdtToUSDTTokenAmount),
        );
        const unclaimedLocalCurrentB1 = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderB(),
            new BigNumber(9000000000).plus(cusdtToUSDTTokenAmount),
            new BigNumber(500000000),
        );
        const unclaimedLocalCurrentC1 = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderC(),
            new BigNumber(9000000000).plus(cusdtToUSDTTokenAmount),
            new BigNumber(2500000000),
        );

        await derivadex
            .claimDDXFromInsuranceMining(fixtures.traderA())
            .awaitTransactionSuccessAsync({ from: fixtures.traderA() });
        await derivadex
            .claimDDXFromInsuranceMining(fixtures.traderB())
            .awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        await derivadex
            .claimDDXFromInsuranceMining(fixtures.traderC())
            .awaitTransactionSuccessAsync({ from: fixtures.traderC() });

        await advanceBlocksAsync(derivadex.providerEngine, 10);

        unclaimedLocalCurrentA2 = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderA(),
            new BigNumber(9000000000).plus(cusdtToUSDTTokenAmount),
            new BigNumber(6000000000).plus(cusdtToUSDTTokenAmount),
        );
        unclaimedLocalCurrentB2 = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderB(),
            new BigNumber(9000000000).plus(cusdtToUSDTTokenAmount),
            new BigNumber(500000000),
        );
        unclaimedLocalCurrentC2 = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderC(),
            new BigNumber(9000000000).plus(cusdtToUSDTTokenAmount),
            new BigNumber(2500000000),
        );

        expect(unclaimedLocalCurrentA1).to.be.bignumber.eq(unclaimedLocalCurrentA2);
        expect(unclaimedLocalCurrentB1).to.be.bignumber.eq(unclaimedLocalCurrentB2);
        expect(unclaimedLocalCurrentC1).to.be.bignumber.eq(unclaimedLocalCurrentC2);
    });

    it('withdraws USDT from insurance fund in third index', async () => {
        // Pre claiming data
        const traderABalancePreClaim = await derivadex.getBalanceOfDDXAsync(fixtures.traderA());
        let traderAAttributes = await derivadex.getTraderAsync(fixtures.traderA());
        expect(traderAAttributes.ddxWalletContract).to.not.eq(ZERO_ADDRESS);
        const traderAWalletBalancePreClaim = await derivadex.getBalanceOfDDXAsync(traderAAttributes.ddxWalletContract);
        expect(traderAWalletBalancePreClaim).to.be.bignumber.eq(traderAAttributes.ddxBalance);

        const cusdtToUSDTTokenAmount = await derivadex.getUSDTTokensFromCUSDTAsync(
            CUSDT.collateralAddress,
            50000000000,
        );
        const unclaimedLocalCurrentA = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderA(),
            new BigNumber(9000000000).plus(cusdtToUSDTTokenAmount),
            new BigNumber(6000000000).plus(cusdtToUSDTTokenAmount),
        );
        const unclaimedLocalNextA = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderA(),
            new BigNumber(9000000000).plus(cusdtToUSDTTokenAmount),
            new BigNumber(6000000000).plus(cusdtToUSDTTokenAmount),
            false,
        );
        const unclaimedDDXRewardsA = await derivadex.getUnclaimedDDXRewardsAsync(fixtures.traderA());
        expect(unclaimedLocalCurrentA.dp(2)).to.be.bignumber.eq(unclaimedDDXRewardsA.dp(2));

        const initInsuranceMineInfoA = await derivadex.getInsuranceMineInfoAsync();
        // Staking Trader A
        await derivadex
            .withdrawFromInsuranceFund(USDT.collateralName, 3500)
            .awaitTransactionSuccessAsync({ from: fixtures.traderA() });

        const insuranceMineInfoA = await derivadex.getInsuranceMineInfoAsync();
        expect(insuranceMineInfoA.minedAmount.dp(2)).to.be.bignumber.eq(
            initInsuranceMineInfoA.minedAmount.plus(unclaimedLocalNextA).dp(2),
        );

        const traderABalancePostClaim = await derivadex.getBalanceOfDDXAsync(fixtures.traderA());
        expect(traderABalancePostClaim.minus(traderABalancePreClaim).dp(2)).to.be.bignumber.eq(0);
        traderAAttributes = await derivadex.getTraderAsync(fixtures.traderA());
        const traderAWalletBalancePostClaim = await derivadex.getBalanceOfDDXAsync(traderAAttributes.ddxWalletContract);
        expect(traderAWalletBalancePostClaim).to.be.bignumber.eq(traderAAttributes.ddxBalance);
        expect(traderAWalletBalancePostClaim.dp(2)).to.be.bignumber.eq(
            traderAWalletBalancePreClaim.plus(unclaimedLocalNextA).dp(2),
        );
        expect(traderAWalletBalancePostClaim.dp(2)).to.be.bignumber.eq(traderAAttributes.ddxBalance.dp(2));

        // Get addresses (collateral, underlying, and diFund tokens) and flavor
        const stakeCollateralUSDT = await derivadex.getStakeCollateralByCollateralNameAsync(USDT.collateralName);

        expect(stakeCollateralUSDT.cap).to.be.bignumber.eq(3000);
        expect(stakeCollateralUSDT.withdrawalFeeCap).to.be.bignumber.eq(17.5);

        // Get current stake details for Trader A and USDT
        const currentStakeByCollateralNameAndStakerAUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            USDT.collateralName,
            fixtures.traderA(),
        );
        expect(currentStakeByCollateralNameAndStakerAUSDT.stakerStake).to.be.bignumber.eq(2500);
        expect(currentStakeByCollateralNameAndStakerAUSDT.globalCap).to.be.bignumber.eq(3000);
        expect(currentStakeByCollateralNameAndStakerAUSDT.normalizedStakerStake).to.be.bignumber.eq(2500);
        expect(currentStakeByCollateralNameAndStakerAUSDT.normalizedGlobalCap).to.be.bignumber.eq(3000);

        cusdtToUSDTAmount = await derivadex.getUSDTFromCUSDTAsync(CUSDT.collateralAddress, 500);

        // Get current stake details for Trader A and cUSDT
        const currentStakeByCollateralNameAndStakerACUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            CUSDT.collateralName,
            fixtures.traderA(),
        );
        expect(currentStakeByCollateralNameAndStakerACUSDT.stakerStake).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerACUSDT.globalCap).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerACUSDT.normalizedStakerStake.dp(2)).to.be.bignumber.eq(
            cusdtToUSDTAmount.dp(2),
        );
        expect(currentStakeByCollateralNameAndStakerACUSDT.normalizedGlobalCap.dp(2)).to.be.bignumber.eq(
            cusdtToUSDTAmount.dp(2),
        );

        // Get current stake details for Trader A and aUSDT
        const currentStakeByCollateralNameAndStakerAAUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            AUSDT.collateralName,
            fixtures.traderA(),
        );
        expect(currentStakeByCollateralNameAndStakerAAUSDT.stakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerAAUSDT.globalCap).to.be.bignumber.eq(2500);
        expect(currentStakeByCollateralNameAndStakerAAUSDT.normalizedStakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerAAUSDT.normalizedGlobalCap).to.be.bignumber.eq(2500);

        // Get current stake details for Trader B and USDT
        const currentStakeByCollateralNameAndStakerBUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            USDT.collateralName,
            fixtures.traderB(),
        );
        expect(currentStakeByCollateralNameAndStakerBUSDT.stakerStake).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerBUSDT.globalCap).to.be.bignumber.eq(3000);
        expect(currentStakeByCollateralNameAndStakerBUSDT.normalizedStakerStake).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerBUSDT.normalizedGlobalCap).to.be.bignumber.eq(3000);

        // Get current stake details for Trader B and cUSDT
        const currentStakeByCollateralNameAndStakerBCUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            CUSDT.collateralName,
            fixtures.traderB(),
        );
        expect(currentStakeByCollateralNameAndStakerBCUSDT.stakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerBCUSDT.globalCap).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerBCUSDT.normalizedStakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerBCUSDT.normalizedGlobalCap.dp(2)).to.be.bignumber.eq(
            cusdtToUSDTAmount.dp(2),
        );

        // Get current stake details for Trader B and aUSDT
        const currentStakeByCollateralNameAndStakerBAUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            AUSDT.collateralName,
            fixtures.traderB(),
        );
        expect(currentStakeByCollateralNameAndStakerBAUSDT.stakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerBAUSDT.globalCap).to.be.bignumber.eq(2500);
        expect(currentStakeByCollateralNameAndStakerBAUSDT.normalizedStakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerBAUSDT.normalizedGlobalCap).to.be.bignumber.eq(2500);

        // Get current stake details for Trader C and USDT
        const currentStakeByCollateralNameAndStakerCUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            USDT.collateralName,
            fixtures.traderC(),
        );
        expect(currentStakeByCollateralNameAndStakerCUSDT.stakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerCUSDT.globalCap).to.be.bignumber.eq(3000);
        expect(currentStakeByCollateralNameAndStakerCUSDT.normalizedStakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerCUSDT.normalizedGlobalCap).to.be.bignumber.eq(3000);

        // Get current stake details for Trader C and cUSDT
        const currentStakeByCollateralNameAndStakerCCUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            CUSDT.collateralName,
            fixtures.traderC(),
        );
        expect(currentStakeByCollateralNameAndStakerCCUSDT.stakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerCCUSDT.globalCap).to.be.bignumber.eq(500);
        expect(currentStakeByCollateralNameAndStakerCCUSDT.normalizedStakerStake).to.be.bignumber.eq(0);
        expect(currentStakeByCollateralNameAndStakerCCUSDT.normalizedGlobalCap.dp(2)).to.be.bignumber.eq(
            cusdtToUSDTAmount.dp(2),
        );

        // Get current stake details for Trader C and aUSDT
        const currentStakeByCollateralNameAndStakerCAUSDT = await derivadex.getCurrentStakeByCollateralNameAndStakerAsync(
            AUSDT.collateralName,
            fixtures.traderC(),
        );
        expect(currentStakeByCollateralNameAndStakerCAUSDT.stakerStake).to.be.bignumber.eq(2500);
        expect(currentStakeByCollateralNameAndStakerCAUSDT.globalCap).to.be.bignumber.eq(2500);
        expect(currentStakeByCollateralNameAndStakerCAUSDT.normalizedStakerStake).to.be.bignumber.eq(2500);
        expect(currentStakeByCollateralNameAndStakerCAUSDT.normalizedGlobalCap).to.be.bignumber.eq(2500);

        const currentTotalStakesA = await derivadex.getCurrentTotalStakesAsync(fixtures.traderA());
        expect(currentTotalStakesA.normalizedStakerStakeSum.dp(2)).to.be.bignumber.eq(
            new BigNumber(2500).plus(cusdtToUSDTAmount).dp(2),
        );
        expect(currentTotalStakesA.normalizedGlobalCapSum.dp(2)).to.be.bignumber.eq(
            new BigNumber(5500).plus(cusdtToUSDTAmount).dp(2),
        );

        const currentTotalStakesB = await derivadex.getCurrentTotalStakesAsync(fixtures.traderB());
        expect(currentTotalStakesB.normalizedStakerStakeSum).to.be.bignumber.eq(500);
        expect(currentTotalStakesB.normalizedGlobalCapSum.dp(2)).to.be.bignumber.eq(
            new BigNumber(5500).plus(cusdtToUSDTAmount).dp(2),
        );

        const currentTotalStakesC = await derivadex.getCurrentTotalStakesAsync(fixtures.traderC());
        expect(currentTotalStakesC.normalizedStakerStakeSum).to.be.bignumber.eq(2500);
        expect(currentTotalStakesC.normalizedGlobalCapSum.dp(2)).to.be.bignumber.eq(
            new BigNumber(5500).plus(cusdtToUSDTAmount).dp(2),
        );
    });

    it('claims a couple times for Traders A, B, C again', async () => {
        const diFundTokenAddress = (await derivadex.getStakeCollateralByCollateralNameAsync(USDT.collateralName))
            .diFundToken;
        await derivadex
            .transferDIFundToken(diFundTokenAddress, fixtures.traderD(), 1000)
            .awaitTransactionSuccessAsync({ from: fixtures.traderA() });
        const diFundTokenBalanceUSDTA = await derivadex.getBalanceOfDIFundTokenAsync(
            USDT.collateralName,
            fixtures.traderA(),
        );
        const diFundTokenBalanceUSDTD = await derivadex.getBalanceOfDIFundTokenAsync(
            USDT.collateralName,
            fixtures.traderD(),
        );
        expect(diFundTokenBalanceUSDTA).to.be.bignumber.eq(1500);
        expect(diFundTokenBalanceUSDTD).to.be.bignumber.eq(1000);
        await derivadex
            .claimDDXFromInsuranceMining(fixtures.traderB())
            .awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        await derivadex
            .claimDDXFromInsuranceMining(fixtures.traderC())
            .awaitTransactionSuccessAsync({ from: fixtures.traderC() });

        await advanceBlocksAsync(derivadex.providerEngine, 10);

        const cusdtToUSDTTokenAmount = await derivadex.getUSDTTokensFromCUSDTAsync(
            CUSDT.collateralAddress,
            50000000000,
        );
        const unclaimedLocalCurrentA1 = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderA(),
            new BigNumber(5500000000).plus(cusdtToUSDTTokenAmount),
            new BigNumber(2500000000).plus(cusdtToUSDTTokenAmount),
        );
        const unclaimedLocalCurrentB1 = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderB(),
            new BigNumber(5500000000).plus(cusdtToUSDTTokenAmount),
            new BigNumber(500000000),
        );
        const unclaimedLocalCurrentC1 = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderC(),
            new BigNumber(5500000000).plus(cusdtToUSDTTokenAmount),
            new BigNumber(2500000000),
        );

        expect(unclaimedLocalCurrentA1.lt(unclaimedLocalCurrentA2)).to.eq(true);
        expect(unclaimedLocalCurrentB1.gt(unclaimedLocalCurrentB2)).to.eq(true);
        expect(unclaimedLocalCurrentC1.gt(unclaimedLocalCurrentC2)).to.eq(true);

        const traderAAttributes = await derivadex.getTraderAsync(fixtures.traderA());
        const traderAWalletBalance = await derivadex.getBalanceOfDDXAsync(traderAAttributes.ddxWalletContract);
        const traderAClaimedDDX = await derivadex.getDDXClaimantStateAsync(fixtures.traderA());
        expect(traderAWalletBalance.dp(2)).to.be.bignumber.eq(traderAAttributes.ddxBalance.dp(2));
        expect(traderAWalletBalance.dp(2)).to.be.bignumber.eq(traderAClaimedDDX.claimedDDX.plus(10).dp(2));
    });

    it('insurance miner can claim earned rewards after "mineRateForBlock" has been updated', async () => {
        const traderBAttributes = await derivadex.getTraderAsync(fixtures.traderB());
        expect(traderBAttributes).to.not.be.eq(ZERO_ADDRESS);
        const traderBWalletBalancePreClaim = await derivadex.getBalanceOfDDXAsync(traderBAttributes.ddxWalletContract);
        await advanceBlocksAsync(derivadex.providerEngine, 10);

        // Submit a governance proposal to change the "mineRatePerBlock" to 0.
        const targets = [derivadex.derivaDEXContract.address];
        const values = [0];
        const signatures = [derivadex.insuranceFundContract.getFunctionSignature('setMineRatePerBlock')];
        const calldatas = [
            generateCallData(
                derivadex.insuranceFundContract.setMineRatePerBlock(new BigNumber(0)).getABIEncodedTransactionData(),
            ),
        ];
        const description = 'Set the mine rate for each block to zero.';
        await derivadex
            .propose(targets, values, signatures, calldatas, description)
            .awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await advanceBlocksAsync(derivadex.providerEngine, 2);
        await derivadex.castVote(13, true).awaitTransactionSuccessAsync({ from: fixtures.derivaDEXWallet() });
        await derivadex.queue(13).awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        await advanceTimeAsync(derivadex.providerEngine, 259200);
        await advanceBlocksAsync(derivadex.providerEngine, 1);
        await derivadex.execute(13).awaitTransactionSuccessAsync({ from: fixtures.traderB() });

        // Claim the insurance miner's DDX.
        const cusdtToUSDTTokenAmount = await derivadex.getUSDTTokensFromCUSDTAsync(
            CUSDT.collateralAddress,
            50000000000,
        );
        const unclaimedLocalCurrentB = await derivadex.getUnclaimedDDXRewardsLocalAsync(
            fixtures.traderB(),
            new BigNumber(5500000000).plus(cusdtToUSDTTokenAmount),
            new BigNumber(500000000),
        );
        await derivadex
            .claimDDXFromInsuranceMining(fixtures.traderB())
            .awaitTransactionSuccessAsync({ from: fixtures.traderB() });
        const traderBWalletBalancePostClaim = await derivadex.getBalanceOfDDXAsync(traderBAttributes.ddxWalletContract);
        expect(traderBWalletBalancePostClaim.dp(2)).to.be.bignumber.eq(
            traderBWalletBalancePreClaim.plus(unclaimedLocalCurrentB).dp(2),
        );
    });
});
// tslint:disable-line:max-file-line-count

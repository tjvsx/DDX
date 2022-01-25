# DerivaDEX V1 Protocol Specification

The first version of DerivaDEX implements the smart contract logic for:

-   DDX Token
-   Governance
-   Insurance Mining

##### Token & Governance

_Both the DDX token and the governance framework have taken heavy inspiration from the
framework beautifully laid out by Compound. There are natural synergies the project is actively
exploring with Compound (given an angel investor at Compound and mutual investors, and
greatly appreciates the thoughtfulness in design and implementation for both the token and
governance modules._

The DerivaDEX token (DDX) is a utility token used for governance and operations on the exchange.
It implements the ERC-20 standard interface, but has additional functionality with baked-in
voting and delegation functionalities.

The governance framework employed by DerivaDEX uses a Governance contract.

The Governance contract facilitates:

-   Proposals: these are made by authorized participants that meet certain token-holding thresholds
    and consist of on-chain executable commands if successful.
-   Voting: the voting period starts some time period after the proposal is made, and lasts for some
    duration of time. Participants can vote during this time and their voting power is defined by how
    many tokens they were holding at the time the proposal vote period began. This methodology saves
    the need from looping through all the votes after the fact, which can be quite expensive. Proposals
    are deemed successful if one of two conditions is met: 1) the voting period has ended and there is
    a majority of for votes vs. against votes, and the minimum quorum has been met, or 2) enough votes
    in either direction have taken place such that the proposal can immediately be rejected or queued
    (successful) - there's a `skipRemainingVotesThreshold` parameter that specifies this threshold
    at which the remaining voting period can be skipped.
-   Queue: after the voting period ends, a proposal's state can be assessed. It will be deemed successful
    if there's a majority of votes in favor and if the quorum is met. A successful proposal can be
    queued by any address. Once queued, the proposal succeeds, it must remain in the queue for some
    time. This time is initialized to be ~3 days in seconds. Any proposal (which includes system
    upgrades since must also come in as proposals) must go through this 3 day period, EXCEPT for those
    specified in the fast path of execution, which is initialized to be the function `pause` that allows
    us to halt the system if a critical bug were to be found. Like most other aspects of the system,
    this fast path list of function signatures can be modified as well, so the `pause` can be removed
    as the system stabilizes over time.
-   Execute: once a certain amount of time has elapsed (and before the proposal expires), a proposal
    can be executed by any address.

##### Insurance Mining

The insurance fund is a critical component to any exchange implementation dealing with derivatives
and leveraged products. During the normal course of the exchange's operations, the insurance fund
will grow organically. However, in the early days, an empty (or limited insurance fund) would
create a bad trading UX. Thus, it's important to bootstrap the insurance fund pre-launch to
mitigate against auto-deleverage scenarios in the early going.

We do this via a novel insurance mining program. The crux of it is that participants can stake
collateral into the insurance fund and in return, will receive a portion of DDX token emission to
compensate them. All of the necessary parameters are directly or indirectly adjustable by way of
governance resulting in fine tuning parameters or upgrading contracts entirely. That being said,
we will describe insurance mining from the lens of the initialized properties to assist in the
explanation.

-   The insurance fund supports USDT, cUSDT, aUSDT, and HUSD as collateral types participants can stake
-   When they make a deposit, participants will receive a corresponding token that represents their deposit. For example, a user who deposits USDT will receive DDX-INS that represents their stake in the fund's overall capitalization. Initially, this will be 1-1 but may fluctuate (for example, if there are liquidation events that drain the underlying capital in the fund, now users will not be able to redeem as much underlying as they had initially deposited when returning their insurance fund tokens).
-   Insurance mining will last about a year (`2102400` blocks).
-   `1.189117199391172` DDX tokens will be issued continuously per block to all those who have staked in the insurance fund. This
    number was chosen such that by the end of the program, roughly `5%` of the `50mm` DDX liquidity
    mining token supply will have been issued.
-   Participants can stake a supported collateral type at any point during the mining program, receiving insurance fund tokens. Users will receive an insurance fund token unit for every collateral unit they deposit at a 1-1 ratio.
-   Participants can withdraw any stake they have deposited to the insurance fund at any time by redeeming (burning) their insurance fund tokens. They redeem underlying proportional to their insurance token holdings. More specifically, although they've received tokens at a 1-1 ratio of their deposit/stake, due to the exchange's operations, the insurance fund may be drained. In this case, they will redeem less than their initial deposit. Users will receive a proportional amount of the underlying collateral backing the insurance fund in proportion to their insurance fund token holdings.
    However, there will be a flat fee associated with any withdrawal of %0.5.
-   Participants can claim their DDX stake continuously. Claims can happen with any interaction with the protocol
    (i.e. staking, withdrawing, and also manually claiming). Transferring DDX-INS tokens will also trigger a claim event.
-   COMP and aToken rewards that accrue to the contract work a bit differently. Every week long interval, a function to advance
    the contract (`advanceOtherRewardsInterval`) can take place, effectively checkpointing the cToken and aToken holdings, along with claiming these additional rewards.
    Since the DDX-INS tokens are checkpointed already natively in the ERC-20, we can figure out how much COMP and aToken rewards a user is entitled to, which we do by looking at their token holdings at the block prior to this checkpointed block number.
    They claim these additional rewards the first time they claim their continuous DDX after this other rewards
    checkpoint has been created. They can only claim these other rewards once per cycle. The `advanceOtherRewardsInterval` can only be called until the time where
    the checkpoint block number stops being less than the insurance mining end block number prior to being called. In other words, it can be called such that
    the checkpoint block number exceeds the final insurance mining block number, but not again. This dynamic, and given that the claim rewards logic maxes the `deltaBlocks` parameter to the insurance mining
    final block number as the reference point means that users can claim rewards retroactively (via withdraw or manual claim) and although they will get 0 DDX since insurance
    mining has ended, they can still retrieve any COMP and extra aTokens they are entitled to in that final week.
-   There will be a "cliff" (`rewardCliff`) before DDX rewawrds can be unlocked. This cliff will be set via governance. After the cliff is passed, DDX tokens that have already been earned will be available to be claimed. There are no further restrictions on DDX after it has been awarded.

When participants claim their DDX reward (even if the `rewardCliff` hasn't passed), it calls the `Trader` facet to issue the DDX reward.
Issuing DDX reward means minting DDX from the proxy contract (which is the only party authorized
to do so) to the trader's on-chain DDX wallet. On-chain DDX wallets are cloneable contracts (as
per the Clonelib implementation for EIP-1167). These are required to allow for traders to stake/
issued rewards to count for a trader's voting power, since these on-chain wallets are initialized
to delegate its balance back to the trader. Rewards can only be withdrawn when the `rewardCliff`
has elapsed, which can only be lifted via governance.

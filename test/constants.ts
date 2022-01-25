export const FORK_URL = 'https://mainnet.infura.io/v3/d585873e117046e18a813cc5f614fcad';

// Governance Deployment Parameters
export const GOVERNANCE_DEPLOYMENT_CONSTANTS = {
    proposalMaxOperations: 10,
    votingDelay: 1,
    votingPeriod: 17280, // 3 days worth of blocks
    gracePeriod: 1209600, // 14 days worth of seconds
    timelockDelay: 259200, // ~ 3 days worth of seconds
    quorumVotes: 4,
    proposalThreshold: 1,
    skipRemainingVotingThreshold: 50,
};

// Insurance Mining Deployment Parameters
export const INSURANCE_MINING_DEPLOYMENT_CONSTANTS = {
    interval: 40320, // 4 * 60 * 24 * 7 = 1 week's worth of blocks
    withdrawalFactor: 995, // 0.5% withdrawal fee
    mineRatePerBlock: 1.189117199391172, // 0.05 * 50_000_000 / 365 / 24 / 60 / 60 * 15 = 5% of liquidity-mine supply / block
    advanceIntervalReward: 10, // DDX reward for advancing interval
    insuranceMiningLength: 2102400, // 365 * 24 * 60 * 4 = 1 year's worth of blocks
};

let { ethers, network } = require("hardhat");

async function moveBlocks(amount) {
    console.log("Moving blocks...")
    for (let index = 0; index < amount; index++) {
        await network.provider.request({
            method: "evm_mine",
            params: [],
        })
    }
    console.log(`Moved ${amount} blocks`)
}

async function moveTime(amount) {
    console.log("Moving blocks...")
    await network.provider.send("evm_increaseTime", [amount])

    console.log(`Moved forward in time ${amount} seconds`)
}

async function main() {
    let [owner] = await ethers.getSigners();
    //1:部署GovernanceToken
    let GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    let governanceToken = await GovernanceToken.deploy();
    await governanceToken.deployed();
    console.log("governanceToken:" + governanceToken.address);

    //2:部署TimeLock
    const MIN_DELAY = 600 // 10 mins- after a vote passes, you have 10 mins before you can enact
    let TimeLock = await ethers.getContractFactory("TimeLock");
    let timeLock = await TimeLock.deploy(MIN_DELAY, [], []);
    await timeLock.deployed();
    console.log("timeLock:" + timeLock.address);

    //3:部署GovernorContract
    const QUORUM_PERCENTAGE = 4; // Need 4% of voters to pass
    const VOTING_PERIOD = 5; // blocks
    const VOTING_DELAY = 1; // 1 Block - How many blocks till a proposal vote becomes active
    let GovernorContract = await ethers.getContractFactory("GovernorContract");
    let governorContract = await GovernorContract.deploy(governanceToken.address, timeLock.address, QUORUM_PERCENTAGE, VOTING_PERIOD, VOTING_DELAY);
    await governorContract.deployed();
    console.log("governorContract:" + governorContract.address);

    //4:分配角色权限
    const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
    const proposerRole = await timeLock.PROPOSER_ROLE();
    const executorRole = await timeLock.EXECUTOR_ROLE();
    const adminRole = await timeLock.TIMELOCK_ADMIN_ROLE();
    await timeLock.grantRole(proposerRole, governorContract.address);
    await timeLock.grantRole(executorRole, ADDRESS_ZERO);
    await timeLock.revokeRole(adminRole, owner.address);
    console.log("权限已分配好");

    //5:部署Treasury
    let ethAmount = ethers.utils.parseUnits("1", 16); //转0.01个以太
    let Treasury = await ethers.getContractFactory("Treasury");
    let treasury = await Treasury.deploy({ value: ethAmount });
    await treasury.deployed();
    console.log("treasury:" + treasury.address);

    //6:合约管理员权限转给timelock
    await treasury.transferOwnership(timeLock.address);
    console.log("合约管理员权限转给timelock");

    //7:新建个提议
    const encodedFunctionCall = treasury.interface.encodeFunctionData("withdraw", []);
    const PROPOSAL_DESCRIPTION = "treasury withdraw all the eth";
    const descriptionHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(PROPOSAL_DESCRIPTION))
    const proposeTx = await governorContract.propose(
        [treasury.address],
        [0],
        [encodedFunctionCall],
        PROPOSAL_DESCRIPTION
    );
    await moveBlocks(VOTING_DELAY + 1);
    const proposeReceipt = await proposeTx.wait(1);
    const proposalId = proposeReceipt.events[0].args.proposalId;
    console.log(`Proposed with proposal ID:\n  ${proposalId}`);
    let proposalState = await governorContract.state(proposalId);
    const proposalSnapShot = await governorContract.proposalSnapshot(proposalId);
    const proposalDeadline = await governorContract.proposalDeadline(proposalId);
    // The state of the proposal. 1 is not passed. 0 is passed.
    console.log(`Current Proposal State: ${proposalState}`);
    // What block # the proposal was snapshot
    console.log(`Current Proposal Snapshot: ${proposalSnapShot}`);
    // The block number the proposal voting expires
    console.log(`Current Proposal Deadline: ${proposalDeadline}`);

    //8:开始投票
    // 0 = Against, 1 = For, 2 = Abstain for this example
    const voteWay = 1
    const reason = "I want to do this";
    console.log("Voting...");
    const voteTx = await governorContract.castVoteWithReason(proposalId, voteWay, reason);
    const voteTxReceipt = await voteTx.wait(1);
    console.log(voteTxReceipt.events[0].args.reason);
    proposalState = await governorContract.state(proposalId);
    console.log(`Current Proposal State: ${proposalState}`);
    await moveBlocks(VOTING_PERIOD + 1);

    //9:入队列等待执行
    console.log("Queueing...");
    const queueTx = await governorContract.queue([treasury.address], [0], [encodedFunctionCall], descriptionHash);
    await queueTx.wait(1);
    await moveTime(MIN_DELAY + 1);
    await moveBlocks(1);
    console.log("Executing...");
    const executeTx = await governorContract.execute(
        [treasury.address],
        [0],
        [encodedFunctionCall],
        descriptionHash
    )
    await executeTx.wait(1);
    console.log("DAO治理已完成！");


}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });

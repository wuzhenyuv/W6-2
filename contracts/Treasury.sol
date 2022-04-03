// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

contract Treasury is Ownable {
    address public dev = 0x6aCB38f47C14594F58614B89Aac493e1Ab3B4C34;

    constructor() payable{}

    receive() external payable {}

    function withdraw() public onlyOwner {
        uint256 amount = address(this).balance;
        (bool success, ) = payable(dev).call{value: amount}("");
        require(success, "Failed to send Ether");
    }
}

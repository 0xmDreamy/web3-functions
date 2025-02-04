import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { BigNumber, Contract, utils } from "ethers";
import ky from "ky";

const HARVESTER_ABI = [
  "function lastExecution() external view returns(uint256)",
  "function totalRewardsBalanceAfterClaiming() external view returns(uint256)",
  "function run(uint256) external",
];

const TOKEN_ABI = [
  "function balanceOf(address) external view returns(uint256)",
];

const SWAPPER_ABI = ["function swapMimForSpell1Inch(address,bytes) external"];

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, storage, multiChainProvider } = context;

  const provider = multiChainProvider.default();

  // Retrieve Last oracle update time
  const execAddress = userArgs.execAddress as string;
  const zeroExApiBaseUrl = userArgs.zeroExApiBaseUrl;
  const fromTokenAddress = "0x99D8a9C45b2ecA8864373A26D1459e3Dff1e17F3"; // MIM
  const toTokenAddress = "0x090185f2135308BaD17527004364eBcC2D37e5F6"; // SPELL

  const lastTimestampStr = (await storage.get("lastTimestamp")) ?? "0";
  const lastTimestamp = parseInt(lastTimestampStr);

  const apiKey = await context.secrets.get("ZEROX_API_KEY");
  if (!apiKey) {
    return { canExec: false, message: "ZEROX_API_KEY not set in secrets" };
  }

  let fromTokenAmount;
  let mim;

  const timestamp = (
    await provider.getBlock("latest")
  ).timestamp;

  if (timestamp < lastTimestamp + 3600) {
    // Update storage to persist your current state (values must be cast to string)
    return { canExec: false, message: "Time not elapsed" };
  }

  try {
    mim = new Contract(fromTokenAddress, TOKEN_ABI, provider);
    const fromTokenAmountBN = await mim.balanceOf(execAddress);
    if (fromTokenAmountBN.lt(utils.parseEther("100"))) {
      return { canExec: false, message: `not enough mim` };
    }
    fromTokenAmount =
      fromTokenAmountBN <= utils.parseEther("10000")
        ? fromTokenAmountBN.toString()
        : utils.parseEther("10000").toString();
  } catch (err) {
    return { canExec: false, message: "Rpc call failed" };
  }

  const api = ky.extend({
    hooks: {
      beforeRequest: [
        request => {
          request.headers.set('0x-api-key', apiKey);
        }
      ]
    }
  });

  const quoteApi = `${zeroExApiBaseUrl}/swap/v1/quote?buyToken=${toTokenAddress}&sellToken=${fromTokenAddress}&sellAmount=${fromTokenAmount.toString()}`;
  logInfo(quoteApi);
  const quoteApiRes: any = await api.get(quoteApi).json();

  if (!quoteApiRes) throw Error("Get quote api failed");
  const quoteResObj = quoteApiRes;

  let value = quoteResObj.buyAmount;
  if (!value) throw Error("No buyAmount");
  const toTokenAmount = BigNumber.from(value);

  console.log(utils.formatEther(fromTokenAmount));
  console.log(utils.formatEther(toTokenAmount).toString());

  if (toTokenAmount.lt(utils.parseEther("100000")))
    return { canExec: false, message: "not enough on contract" };

  value = quoteResObj.data;
  if (!value) throw Error("No data");
  const data = value.toString();

  value = quoteResObj.to;
  if (!value) throw Error("No data");
  const routerAddress = value.toString();

  const swapper = new Contract(execAddress, SWAPPER_ABI, provider);

  await storage.set("lastTimestamp", timestamp.toString());

  return {
    canExec: true,
    callData: [{
      to: execAddress,
      data: swapper.interface.encodeFunctionData("swapMimForSpell1Inch", [
        routerAddress,
        data,
      ])
    }],
  };
});

function logInfo(msg: string): void {
  console.info(msg);
}

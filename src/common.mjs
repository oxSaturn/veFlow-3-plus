import { createPublicClient, formatUnits, http } from "viem";
import { parseAbiItem } from "viem";
import fs from "node:fs";
import { abi } from "./abi.mjs";
import { canto } from "viem/chains";

export const cantoPublicClient = createPublicClient({
  chain: canto,
  transport: http("https://mainnode.plexnode.org:8545", {
    retryDelay: 61_000,
  }),
});

// different rpcs will support different chunk sizes
// most supports 10000n
// while some like op only supports 1024n for eth_getLogs

async function getMaxNFTId(
  publicClient,
  veContractAddress,
  chunkSize = 10000n,
  toBlock
) {
  if (!toBlock) {
    toBlock = await publicClient.getBlockNumber();
    console.log("blockNumber", toBlock);
  }
  try {
    const fromBlock = toBlock - chunkSize;

    const logs = await publicClient.getLogs({
      address: veContractAddress,
      event: parseAbiItem(
        "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
      ),
      args: {
        from: "0x0000000000000000000000000000000000000000",
      },
      toBlock: toBlock,
      fromBlock,
    });
    if (logs.length === 0) {
      if (fromBlock === 0n) {
        return 0;
      }
      return await getMaxNFTId(
        publicClient,
        veContractAddress,
        chunkSize,
        fromBlock
      );
    } else {
      return Math.max(...logs.map((log) => Number(log.args.tokenId)));
    }
  } catch (err) {
    console.log("something wrong", err);
    // // sleep 1 min
    // await new Promise((resolve) => setTimeout(resolve, 60000))
    // // retry
    // return await getMaxNFTId(publicClient, veContractAddress, toBlock)
  }
}

export async function getNFTs(
  publicClient,
  veContractAddress,
  chunkSize = 10000n
) {
  const t0 = performance.now();

  const maxNFTId = await getMaxNFTId(
    publicClient,
    veContractAddress,
    chunkSize
  );

  const t1 = performance.now();
  console.log(`getMaxNFTId took ${t1 - t0}ms`);
  console.log("maxNFTId", maxNFTId);
  // generate a multicall with all the calls you want to make
  // generate an array of maxNFTNumber length, and fill with number beginning at 1
  const nfts = [...Array(maxNFTId).keys()].map((nft) => nft + 1);

  // velodrome has huge maxNFTId > 25k, which means it will take a long time to get all the balances
  const [totalSupply, ...balances] = await publicClient.multicall({
    contracts: [
      {
        address: veContractAddress,
        abi: abi,
        functionName: "totalSupply",
        args: [],
      },
      ...nfts.map((nft) => ({
        address: veContractAddress,
        abi: abi,
        functionName: "balanceOfNFT",
        args: [nft],
      })),
    ],
    allowFailure: false,
  });

  const t2 = performance.now();
  console.log(`multicall balances took ${t2 - t1}ms`);

  const owners = await publicClient.multicall({
    contracts: nfts.map((nft) => ({
      address: veContractAddress,
      abi: abi,
      functionName: "ownerOf",
      args: [nft],
    })),
    allowFailure: false,
  });

  const t3 = performance.now();
  console.log(`multicall owners took ${t3 - t2}ms`);

  const lockedEnd = await publicClient.multicall({
    contracts: nfts.map((nft) => ({
      address: veContractAddress,
      abi: abi,
      functionName: "locked__end",
      args: [nft],
    })),
    allowFailure: false,
  });

  const data = nfts
    .map((nft, index) => ({
      id: nft,
      balance: formatUnits(balances[index], 18),
      owner: owners[index],
      lockedEnd: Number(lockedEnd[index]),
    }))
    .reduce((acc, obj) => {
      acc[obj.owner] = acc[obj.owner] || [];
      acc[obj.owner].push(obj);
      return acc;
    }, {});
  return Object.entries(data)
    .sort((a, b) => {
      const aTotal = a[1].reduce((acc, obj) => acc + Number(obj.balance), 0);
      const bTotal = b[1].reduce((acc, obj) => acc + Number(obj.balance), 0);
      return bTotal - aTotal;
    })
    .reduce((acc, [key, value]) => {
      const lockedMoreThan3Years = value.filter(
        (obj) =>
          obj.lockedEnd * 1000 - Date.now() >= 60 * 60 * 24 * 365 * 3 * 1000
      );
      acc.push([
        // wallet address
        key,
        // 3y+ veFlow balance
        lockedMoreThan3Years.reduce((acc, obj) => acc + Number(obj.balance), 0),
        // all nfts in the format of `id(lockEnd)`
        value
          .map(
            (obj) =>
              `${obj.id}(${new Date(obj.lockedEnd * 1000).toISOString()})`
          )
          .join(", "),
      ]);
      return acc;
    }, [])
    .sort((a, b) => b[1] - a[1]);
}
export function writeJson(data) {
  fs.writeFileSync("data.json", JSON.stringify(data, null, 2));
}
export function writeCsv(data) {
  fs.writeFileSync(
    "data.csv",
    // add header
    "wallet,veFlow\n" +
      data.map(([wallet, veFlow]) => `${wallet},${veFlow}`).join("\n")
  );
}
export function writeMd(data) {
  fs.writeFileSync(
    "data.md",
    // add header
    // wallet, veFlow, nfts
    "| wallet | veFlow | nfts |\n" +
      "| --- | --- | --- |\n" +
      data
        .map(([wallet, veFlow, nfts]) => `| ${wallet} | ${veFlow} | ${nfts} |`)
        .join("\n")
  );
}

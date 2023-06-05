import {
  cantoPublicClient,
  getNFTs,
  writeCsv,
  writeJson,
  writeMd,
} from "./common.mjs";

const veContractAddress = "0x8E003242406FBa53619769F31606ef2Ed8A65C00";

const data = await getNFTs(cantoPublicClient, veContractAddress);

writeJson(data);
writeCsv(data);
writeMd(data);

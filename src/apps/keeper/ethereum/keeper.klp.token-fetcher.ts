import { Inject } from '@nestjs/common';
import { Token as TokenWrapper } from '@uniswap/sdk-core';
import { Pool, Position } from '@uniswap/v3-sdk';

import { IAppToolkit, APP_TOOLKIT } from '~app-toolkit/app-toolkit.interface';
import { PositionTemplate } from '~app-toolkit/decorators/position-template.decorator';
import { getLabelFromToken } from '~app-toolkit/helpers/presentation/image.present';
import { UniswapV3ContractFactory } from '~apps/uniswap-v3/contracts';
import { AppTokenTemplatePositionFetcher } from '~position/template/app-token.template.position-fetcher';
import {
  GetDisplayPropsParams,
  GetPricePerShareParams,
  GetUnderlyingTokensParams,
} from '~position/template/app-token.template.types';
import { NETWORK_IDS } from '~types';

import { KeeperContractFactory, KeeperKlp } from '../contracts';

@PositionTemplate()
export class EthereumKeeperKlpTokenFetcher extends AppTokenTemplatePositionFetcher<KeeperKlp> {
  groupLabel = 'Keep3r LP';

  constructor(
    @Inject(APP_TOOLKIT) protected readonly appToolkit: IAppToolkit,
    @Inject(KeeperContractFactory) protected readonly contractFactory: KeeperContractFactory,
    @Inject(UniswapV3ContractFactory) protected readonly uniswapV3ContractFactory: UniswapV3ContractFactory,
  ) {
    super(appToolkit);
  }

  getContract(address: string) {
    return this.contractFactory.keeperKlp({ address, network: this.network });
  }

  getAddresses() {
    return ['0x3f6740b5898c5d3650ec6eace9a649ac791e44d7'];
  }

  async getUnderlyingTokenDefinitions({ contract }: GetUnderlyingTokensParams<KeeperKlp>) {
    return [
      { address: await contract.token0(), network: this.network },
      { address: await contract.token1(), network: this.network },
    ];
  }

  async getPricePerShare({ contract, multicall, appToken }: GetPricePerShareParams<KeeperKlp>) {
    const [poolAddress, position, tickLower, tickUpper] = await Promise.all([
      contract.pool(),
      contract.position(),
      contract.tickLower(),
      contract.tickUpper(),
    ]);

    const poolContract = this.uniswapV3ContractFactory.uniswapV3Pool({ address: poolAddress, network: this.network });
    const [slot, fee, liquidity] = await Promise.all([
      multicall.wrap(poolContract).slot0(),
      multicall.wrap(poolContract).fee(),
      multicall.wrap(poolContract).liquidity(),
    ]);

    const [token0, token1] = appToken.tokens;
    const t0 = new TokenWrapper(NETWORK_IDS[this.network]!, token0.address, token0.decimals, token0.symbol);
    const t1 = new TokenWrapper(NETWORK_IDS[this.network]!, token1.address, token1.decimals, token1.symbol);
    const pool = new Pool(t0, t1, Number(fee), slot.sqrtPriceX96.toString(), liquidity.toString(), Number(slot.tick));
    const pos = new Position({ pool, liquidity: position.liquidity.toString(), tickLower, tickUpper });

    const reserve0Raw = pos.amount0.multiply(10 ** token0.decimals).toFixed(0);
    const reserve1Raw = pos.amount1.multiply(10 ** token1.decimals).toFixed(0);
    const reservesRaw = [reserve0Raw, reserve1Raw];
    const reserves = reservesRaw.map((r, i) => Number(r) / 10 ** appToken.tokens[i].decimals);
    const pricePerShare = reserves.map(r => Number(r) / appToken.supply);

    return pricePerShare;
  }

  async getLabel({ appToken }: GetDisplayPropsParams<KeeperKlp>) {
    return appToken.tokens.map(v => getLabelFromToken(v)).join(' / ');
  }

  async getSecondaryLabel({ appToken }: GetDisplayPropsParams<KeeperKlp>) {
    const { reserves, liquidity } = appToken.dataProps;
    const reservePercentages = appToken.tokens.map((t, i) => reserves[i] * (t.price / liquidity));
    return reservePercentages.map(p => `${Math.round(p * 100)}%`).join(' / ');
  }
}

import { Body, Controller, Headers, Post } from "@nestjs/common";
import { Public } from "../auth/decorators";
import { AggregatorService } from "./aggregator.service";
import { AggregatorCancelDto, AggregatorOrderDto } from "./dto";

// Called by delivery-platform integrations (or middleware bridging their
// real webhooks). Authenticated with an AGGREGATOR device token.
@Public()
@Controller("aggregator")
export class AggregatorController {
  constructor(private readonly aggregator: AggregatorService) {}

  @Post("orders")
  ingest(
    @Headers("x-device-token") deviceToken: string | undefined,
    @Body() dto: AggregatorOrderDto,
  ) {
    return this.aggregator.ingest(deviceToken, dto);
  }

  @Post("orders/cancel")
  cancel(
    @Headers("x-device-token") deviceToken: string | undefined,
    @Body() dto: AggregatorCancelDto,
  ) {
    return this.aggregator.cancel(deviceToken, dto.provider, dto.externalRef, dto.reason);
  }
}

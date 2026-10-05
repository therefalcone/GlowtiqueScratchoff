export class EngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class CampaignNotFoundError extends EngineError {
  constructor(id: string) {
    super("campaign_not_found", `campaign ${id} not found`);
  }
}

export class CampaignStateError extends EngineError {
  constructor(message: string) {
    super("campaign_state", message);
  }
}

export class InvalidRewardConfigError extends EngineError {
  constructor(message: string) {
    super("invalid_reward_config", message);
  }
}

export class PoolExhaustedError extends EngineError {
  constructor(remaining: number, requested: number) {
    super(
      "pool_exhausted",
      `the fixed pool has ${remaining} card(s) remaining but ${requested} were requested; nothing was generated`
    );
  }
}

export class RewardNotFoundError extends EngineError {
  constructor() {
    super("reward_not_found", "no reward matches that code");
  }
}

export class RewardStateError extends EngineError {
  readonly status: string;
  constructor(status: string) {
    super("reward_state", `reward is ${status}, not available`);
    this.status = status;
  }
}

export class CardNotFoundError extends EngineError {
  constructor() {
    super("card_not_found", "card not found");
  }
}

export class CardStateError extends EngineError {
  readonly status: string;
  constructor(status: string, message: string) {
    super("card_state", message);
    this.status = status;
  }
}

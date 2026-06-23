-- 020_trading_bot.sql — Bot strategies, pending signals, and full-auto opt-in

CREATE TABLE IF NOT EXISTS bot_strategies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker              text NOT NULL,
  account_id          text NOT NULL,
  strategy_type       text NOT NULL CHECK (strategy_type IN ('momentum','ma_crossover','breakout')),
  params              jsonb NOT NULL DEFAULT '{}',
  mode                text NOT NULL DEFAULT 'semi' CHECK (mode IN ('semi','full')),
  enabled             bool NOT NULL DEFAULT true,
  capital_allocated   numeric(15,2) NOT NULL DEFAULT 0,
  profit_target_pct   numeric(8,2),
  stop_loss_pct       numeric(8,2) NOT NULL DEFAULT 15,
  max_drawdown_pct    numeric(8,2) NOT NULL DEFAULT 20,
  time_horizon_days   int NOT NULL DEFAULT 28,
  max_trades_per_day  int NOT NULL DEFAULT 3,
  nl_description      text,
  nl_risk_disclosed   bool NOT NULL DEFAULT false,
  trades_today        int NOT NULL DEFAULT 0,
  trades_today_date   date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bot_strategies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bot_strategies_owner" ON bot_strategies FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_bot_strategies_user ON bot_strategies(user_id);

CREATE TABLE IF NOT EXISTS pending_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id     uuid NOT NULL REFERENCES bot_strategies(id) ON DELETE CASCADE,
  ticker          text NOT NULL,
  side            text NOT NULL CHECK (side IN ('buy','sell')),
  qty             numeric(12,4) NOT NULL,
  suggested_price numeric(12,4),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','executed','expired')),
  sharia_passed   bool NOT NULL DEFAULT false,
  error_msg       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '60 minutes'),
  executed_at     timestamptz
);

ALTER TABLE pending_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pending_signals_owner" ON pending_signals FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_pending_signals_user ON pending_signals(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_signals_strategy ON pending_signals(strategy_id);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_auto_enabled bool NOT NULL DEFAULT false;

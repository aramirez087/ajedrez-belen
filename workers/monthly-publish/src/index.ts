export interface MonthlyPublishEnv {
  PORTAL: Fetcher;
  CRON_SECRET: string;
}

// Runs daily at 00:00 America/Costa_Rica (06:00 UTC, no DST in CR). Publishing
// is idempotent, so the 1st creates the new month and later runs only catch
// athletes enrolled mid-month or retry a failed 1st.
export default {
  async scheduled(_controller: ScheduledController, env: MonthlyPublishEnv, _ctx: ExecutionContext): Promise<void> {
    const response = await env.PORTAL.fetch('https://internal/api/internal/publish-monthly', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });
    const body = await response.text();
    console.log(JSON.stringify({ event: 'monthly_publish_cron', status: response.status, body }));
    if (!response.ok) throw new Error(`Monthly publish failed with HTTP ${response.status}`);
  },
} satisfies ExportedHandler<MonthlyPublishEnv>;

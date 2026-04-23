export type JiraAuth =
  | {
      kind: "basic";
      email: string;
      apiToken: string;
    }
  | {
      kind: "oauth2";
      accessToken: string;
    };

export interface JiraEnvironment {
  host: string;
  auth: JiraAuth;
  webhook: {
    host: string;
    port: number;
    secret?: string;
  };
}

export interface JiraWebhookEvent {
  source: "jira";
  event: string;
  timestamp: string;
  payload: Record<string, unknown>;
  issue?: {
    key?: string;
  };
  project?: {
    key?: string;
  };
  user: {
    id?: string;
    name?: string;
    email?: string;
  };
}

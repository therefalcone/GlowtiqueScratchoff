export function pgConfig(connectionString: string): {
  connectionString: string;
  ssl: false | { ca?: string; rejectUnauthorized: boolean };
};

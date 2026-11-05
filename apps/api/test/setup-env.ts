import 'dotenv/config';

// Every test process talks to the dedicated test database, never the dev database.
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL must be set to run tests');
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';

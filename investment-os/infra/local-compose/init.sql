-- Public dummy role, isolated local P0 only. API cannot mutate database state.
CREATE ROLE ios_app LOGIN PASSWORD 'dummy-read-only';
GRANT CONNECT ON DATABASE ios_synthetic TO ios_app;
GRANT USAGE ON SCHEMA public TO ios_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ios_dummy IN SCHEMA public GRANT SELECT ON TABLES TO ios_app;

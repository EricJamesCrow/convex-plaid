# TODO

## Pending

- [ ] Create `.env.example` file with standard Plaid sandbox credentials
  - Reference: https://dashboard.plaid.com/developers/keys
  - Variables needed:
    - `PLAID_CLIENT_ID` - Get from Plaid Dashboard
    - `PLAID_SECRET` - Get from Plaid Dashboard (sandbox key)
    - `PLAID_ENV=sandbox` - Use sandbox for development
    - `ENCRYPTION_KEY` - Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
  - Include sandbox test credentials in comments:
    - Username: `user_good`
    - Password: `pass_good`
    - 2FA code: `1234`

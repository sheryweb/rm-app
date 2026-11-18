// Which Salesforce the app talks to. No secret lives here: the client id is public by design
// (the login uses PKCE), and every call is made with the signed-in RM's own Salesforce login.
export const CONFIG = {
  appName: "MIRA RM",
  version: "0.2.0",
  environment: "Sandbox",
  loginUrl: "https://miradevelopments--working.sandbox.my.salesforce.com",
  clientId:
    "3MVG9EJ2FoGDnkgV1H7VERYsM5Wjkps0JuCqU2atWcuAayHPjfZzhMxOG8CI6YKCUbk6OjiwPwkv3M7b7RLF1",
  scopes: "api refresh_token",
  apiPath: "/services/apexrest/rmapp/v1/"
};

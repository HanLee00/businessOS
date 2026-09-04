const DEFAULT_GRAPH_VERSION = "v26.0";

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function assertLocalDate(localDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    throw new Error("localDate must use the ISO local-date format");
  }
}

async function graph(env, path, params, fetcher) {
  const version = env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  const response = await fetcher(url, {
    headers: {
      authorization: `Bearer ${requireValue(env.META_ACCESS_TOKEN, "META_ACCESS_TOKEN")}`
    }
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    const code = body.error?.code || `HTTP_${response.status}`;
    throw new Error(`Meta Graph API failed: ${code}`);
  }
  return body;
}

export async function readMetaAdsDay(env, localDate, fetcher = fetch) {
  assertLocalDate(localDate);
  const accountId = requireValue(env.META_AD_ACCOUNT_ID, "META_AD_ACCOUNT_ID").replace(/^act_/, "");
  const accountPath = `act_${accountId}`;
  const account = await graph(env, accountPath, {
    fields: "id,account_id,name,currency,timezone_name,account_status"
  }, fetcher);

  const expectedName = env.META_AD_ACCOUNT_NAME || "OHVENUS";
  const expectedCurrency = env.META_AD_ACCOUNT_CURRENCY || "MYR";
  const expectedTimeZone = env.META_AD_ACCOUNT_TIME_ZONE || env.TIME_ZONE || "Asia/Kuala_Lumpur";
  if (
    account.id !== accountPath ||
    String(account.account_id) !== accountId ||
    account.name !== expectedName ||
    account.currency !== expectedCurrency ||
    account.timezone_name !== expectedTimeZone ||
    Number(account.account_status) !== 1
  ) {
    throw new Error("Meta account identity, status, currency, or timezone did not match Oh! Venus");
  }

  const insights = await graph(env, `${accountPath}/insights`, {
    fields: "spend,date_start,date_stop",
    level: "account",
    time_increment: "1",
    time_range: JSON.stringify({ since: localDate, until: localDate })
  }, fetcher);
  const rows = insights.data || [];
  if (rows.some((row) => row.date_start !== localDate || row.date_stop !== localDate)) {
    throw new Error("Meta returned spend outside the requested local date");
  }

  const spendSen = rows.reduce((total, row) => {
    const amount = Number(row.spend);
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Meta returned an invalid spend amount");
    return total + Math.round(amount * 100);
  }, 0);

  return {
    source: "meta_ads",
    localDate,
    account: {
      id: account.id,
      accountId: String(account.account_id),
      name: account.name,
      currency: account.currency,
      timeZone: account.timezone_name,
      status: "active"
    },
    spendSen
  };
}

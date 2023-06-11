const { fail } = require("assert");
const axios = require("axios");
const { log } = require("console");
const fs = require('fs');
const { setTimeout } = require("timers/promises");

const PRICEMPIRE_BASE_URL = "https://pricempire.com/api";
const WAX_BASE_URL = "https://api.waxpeer.com/v1";

var priceMPIREApiKey = "";
var waxPeerApiKey = "";
var priceUpperDelimiter = 1.5;
var priceLowerDelimiter = 1.08;
var maxItemsPerListing = -1;
var secondsBetweenWaxListingsUpdates = 60;
var hoursBetweenPriceMPIREPriceUpdate = 6.0;
var hoursBetweenWaxNewListing = 6.0;
var secondsBetweenWaxRequest=5.0;
var waxUpdateLimit=50;
var detailedDelimiter = [];

var priceMPIREItemData = {};
var myListedItems = [];
var waxCache = {};
var lastWaxListingUpdate = Date.now();
var lastPriceMPIREUpdate = Date.now();
var lastWaxNewListing = Date.now();
var items = [];
sharedVariable = {}

function error() {
  console.log(
    "  Wax sent an uncomprerrensible response or closed the connection unexpectedly!"
  );
}

async function loadConfig() {

  var file = await fs.readFileSync('config.json', 'utf8');
  var config = await JSON.parse(file);

  timeToCancelAction = config.time_to_cancel_action;
  priceMPIREApiKey = config.pricempire_api_key;
  waxPeerApiKey = config.waxpeer_api_key;
  priceLowerDelimiter = config.default_delimiter[0];
  priceUpperDelimiter = config.default_delimiter[1];
  maxItemsPerListing = config.max_items_per_listing;
  secondsBetweenWaxRequest=config.seconds_between_wax_request;
  detailedDelimiter = config.detailed_delimiter;
  waxUpdateLimit=config.wax_update_limit;
  secondsBetweenWaxListingsUpdates = config.seconds_between_wax_listings_updates;
  hoursBetweenPriceMPIREPriceUpdate = config.hours_between_pricempire_price_update;
  hoursBetweenWaxNewListing = config.hours_between_wax_new_listing;

  lastWaxNewListing = Date.now() - (hoursBetweenWaxNewListing * 60 * 60 * 1000 + 1);
  lastPriceMPIREUpdate = Date.now() - (hoursBetweenPriceMPIREPriceUpdate * 60 * 60 * 1000 + 1);
  lastWaxListingUpdate = Date.now() - (secondsBetweenWaxListingsUpdates * 1000 + 1);

  console.log("Your config:", config);
}

async function loadPriceMPIREInfo() {

  if ((Date.now() - lastPriceMPIREUpdate) <= (hoursBetweenPriceMPIREPriceUpdate * 60 * 60 * 1000)) {
    if (fs.existsSync('pricempire.txt')) {
      return;
    }
  }

  console.log("===> FETCHING PRICEMPIRE PRICES");

  lastPriceMPIREUpdate = Date.now();
  var res = await axios.get(
    PRICEMPIRE_BASE_URL + "/v3/getAllItems",
    {
      params: {
        api_key: priceMPIREApiKey,
        currency: "USD",
        appId: "730",
        sources: "buff",
      },
    }
  );

  if (res.status !== 200) { error(); return; }

  priceMPIREItemData = res.data;
  await fs.writeFileSync('pricempire.txt', JSON.stringify(priceMPIREItemData, null, 2));

  console.log("  Caching pricempire prices...");
  console.log("  Success!");
  console.log("");
}


function getLowerDelimiter(name) {
  var delimiter = priceLowerDelimiter;
  var price = priceMPIREItemData[name].buff.price / 100.0;
  for (eachDelimiter of detailedDelimiter) {
    if (eachDelimiter.range[0] < price && eachDelimiter.range[1] > price) {
      delimiter = eachDelimiter.delimiter[0];
    }
  }
  return price * delimiter;
}

function getUpperDelimiter(name) {
  var delimiter = priceUpperDelimiter;
  var price = priceMPIREItemData[name].buff.price / 100.0;

  for (eachDelimiter of detailedDelimiter) {
    if (eachDelimiter.range[0] < price && eachDelimiter.range[1] > price) {
      delimiter = eachDelimiter.delimiter[1];
    }
  }
  return price * delimiter;
}

function findLeastWaxPrice(returnedItems) {
  // find the least price listed in waxpeer
  var leastPrice = Number.MAX_VALUE;
  returnedItems.forEach(item => {
    var price = item.price / 1000.0;
    leastPrice = Math.min(price, leastPrice);
  })
  return leastPrice;
}

async function getWaxPriceFor(item) {
  var name = item.name;
  if (name && waxCache.hasOwnProperty(name)) {
    returnedItems = waxCache[name];
  } else {
    try {
      var res = await axios.get(
        WAX_BASE_URL + "/search-items-by-name",
        {
          params: {
            api: waxPeerApiKey,
            game: "csgo",
            names: name,
          },
        }
      );
    } catch { }
    if (res.status !== 200) {
      error();
      return await getLowerDelimiter(item.name);
    }
    returnedItems = res.data.items;

    waxCache[name] = returnedItems;
  }
  if (!returnedItems) {
    return await getUpperDelimiter(item.name);
  }
  var leastWaxPrice = await findLeastWaxPrice(returnedItems);
  var buffLowerDelimiter = await getLowerDelimiter(item.name);
  var buffUpperDelimiter = await getUpperDelimiter(item.name);
  if (leastWaxPrice < buffLowerDelimiter) {
    return buffLowerDelimiter;
  } else if (leastWaxPrice <= buffUpperDelimiter) {
    return leastWaxPrice - 0.001;
  } else {
    return buffUpperDelimiter;
  }
}

async function listMyItems() {
  if ((Date.now() - lastWaxNewListing) < hoursBetweenWaxNewListing * 60 * 60 * 1000) {
    return;
  }

  console.log("===> FETCHING YOUR LISTABLE ITEMS");

  lastWaxNewListing = Date.now();
  var res = await axios.get(
    WAX_BASE_URL + "/fetch-my-inventory",
    {
      params: {
        api: waxPeerApiKey,
        game: "csgo",
      },
    }
  );

  if (res.status !== 200) {
    error();
    return;
  }

  res = await axios.get(
    WAX_BASE_URL + "/get-my-inventory",
    {
      params: {
        api: waxPeerApiKey,
        skip: 0,
        game: "csgo",
      },
    }
  );

  if (res.status !== 200) {
    error();
    return;
  }

  var data = res.data;
  console.log(`Found ${data.count} listable items`);

  if (!data.count || data.count == 0) {
    return;
  }

  console.log("  Calculating prices...");
  for (const item of data.items) {
    // console.log("item:",item);
    var price = await getWaxPriceFor(item) * 1000;
    items.push({
      "item_id": item.item_id,
      "price": price,
    });
  }

  if (maxItemsPerListing > 0 && items.length >= maxItemsPerListing) {
    items = items.slice(0, maxItemsPerListing);
  }

  // print a message
  console.log("  Making listings...");

  res = await axios.post(
    WAX_BASE_URL + "/list-items-steam",
    {
      "items": items,
    }, {
    params: {
      api: waxPeerApiKey,
      game: "csgo",
    },

  });
  if (res.status !== 200) { error(); return; }
  else if (res.data.success === false) { console.log(res.data.msg); }
  else if (res.data.failed.length > 0) {
    console.log("Failed Listings");
    console.log(failed);
  }
  else {
    console.log(`No failed listings.\n\n`);
  }
}


async function updateMyItems() {
  // check if it's time to update listed items
  if ((Date.now() - lastWaxListingUpdate) < secondsBetweenWaxListingsUpdates * 1000) {
    return;
  }

  var res = await axios.get(
    WAX_BASE_URL + "/list-items-steam",
    {
      params: {
        api: waxPeerApiKey,
        game: "csgo",
      },
    }
  );
  // check if the request was successful
  if (res.status !== 200) {
    error();
    return;
  }
  // parse the response data
  myListedItems = res.data.items;
  for (item of myListedItems) {
    res = await axios.get(
      WAX_BASE_URL + "/search-items-by-name",
      {
        params: {
          api: waxPeerApiKey,
          game: "csgo",
          names: item.name,
        },
      }
    );
    // if the request was successful,
    // add the wax price to the wax cache
    if (res.status === 200) {
      waxCache[item.name] = res.data.items;
    }
  }
  // update the last wax listing update time
  lastWaxListingUpdate = Date.now();
  // create a list of updates
  var updates = [];
  if (myListedItems.length > 0) {
    for (item of myListedItems) {
      var itemName = item.name;
      var returnedItems = waxCache[item.name];
      var listedItemPriceInDollars = item.price / 1000.0;
      var leastWaxPrice = await findLeastWaxPrice(returnedItems);
      if (leastWaxPrice < listedItemPriceInDollars) {
        var buffLowerDelimiter = await getLowerDelimiter(itemName);
        var buffUpperDelimiter = await getUpperDelimiter(itemName);
        if (leastWaxPrice < buffLowerDelimiter) {
          newItemPrice = buffLowerDelimiter;
        } else if (leastWaxPrice <= buffUpperDelimiter) {
          newItemPrice = leastWaxPrice - 0.001;
        } else {
          newItemPrice = buffUpperDelimiter;
        }
        updates.push(
          {
            "item_id": item.item_id,
            "name": item.name,
            "old_price": item.price,
            "price": newItemPrice * 1000,
            "least": leastWaxPrice,
          }
        );
      }
    }
  }

  if (updates.length > 0) {

    console.log(`Preparing new row of updates (${updates.length} detected)`);
    var batches = [];
    var full = Math.floor(updates.length / waxUpdateLimit);
    var rem = (updates.length) % waxUpdateLimit;

    for (var i = 0; i < full; i++) {
      batches.push(updates.slice(i * waxUpdateLimit, (i + waxUpdateLimit) * waxUpdateLimit));
    }

    if (rem > 0) {
      batches.push(updates.slice(full * waxUpdateLimit),);
    }

    var updated = [];
    var failed = [];

    for (var idx = 0; idx < batches.length; idx++) {
      log(`Sending batch of updates ${idx + 1} out of ${batches.length}`)
      var sendItems = batches[idx].map(element => ({
        item_id: element.item_id,
        price: Math.floor(element.price),
      }))
     // c/onsole.log(sendItems);
      res = await axios.post(
        WAX_BASE_URL + "/edit-items",
        {
          "items": sendItems
        }, {
        params: {
          "api": waxPeerApiKey,
          "game": "csgo",
        }
      });
      if (res.status !== 200) {
        error();
        continue;
      }

      result = res.data;
      //console.log(result);
      updated = [...updated, ...result.updated];
      failed = [...failed, ...result.failed];
      setTimeout(() => { }, secondsBetweenWaxRequest*1000); // 1000 milliseconds = 1 second
    }

    if (updated.length > 0) {
      console.log(`   Success: ${updated.length}`);
      updates.forEach(update => {
        console.log(`      item id is ${update.item_id} and price is  ${update.price / 1000}`)
      });
    } else {
      console.log("   No success")
    }

    if (failed.length > 0) {
      console.log(`   Failed: ${failed.length}`);
      console.log(`      ${failed[0].msg}`)
    }
    else {
      console.log("   No failed");
    }
  }
  else {
    console.log("   ***No updates***");
  }
}

async function main() {
  await loadConfig();
  while (true) {
    try {
      await loadPriceMPIREInfo();
      await listMyItems();
      await updateMyItems();
    } catch {
      continue;
    }

  }
}

main();
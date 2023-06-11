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
var waxUpdateLimit = 50;
var detailedDelimiter = [];
var showResultDetail = false
var priceMPIREItemData = {};
var myListedItems = [];
var waxCache = {};
var delayCountForUpdate = 0;
var delayCountForList = 0;
var lastWaxListingUpdate = Date.now();
var lastPriceMPIREUpdate = Date.now();
var lastWaxNewListing = Date.now();
var items = [];
var itemIdNamePair = {};

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
  secondsBetweenWaxRequest = config.seconds_between_wax_request;
  detailedDelimiter = config.detailed_delimiter;
  waxUpdateLimit = config.wax_update_limit;
  secondsBetweenWaxListingsUpdates = config.seconds_between_wax_listings_updates;
  hoursBetweenPriceMPIREPriceUpdate = config.hours_between_pricempire_price_update;
  hoursBetweenWaxNewListing = config.hours_between_wax_new_listing;
  showResultDetail = config.show_result_detail;
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
  const promises = data.items && data.items.map(async item => {
    var price = await getWaxPriceFor(item) * 1000;
    items.push({
      "item_id": item.item_id,
      "price": price,
    });
  })
  await Promise.all(promises);

  console.log("  Making listings...");

  var batches = [];
  var full = Math.floor(items.length / maxItemsPerListing);
  var rem = (items.length) % maxItemsPerListing;

  for (var i = 0; i < full; i++) {
    batches.push(items.slice(i * maxItemsPerListing, (i + 1) * maxItemsPerListing));
  }

  if (rem > 0) {
    batches.push(items.slice(full * maxItemsPerListing),);
  }
  for (var idx = 0; idx < batches.length; idx++) {
    res = await axios.post(
      WAX_BASE_URL + "/list-items-steam",
      {
        "items": batches[idx],
      }, {
      params: {
        api: waxPeerApiKey,
        game: "csgo",
      },
    });
    delayCountForList++;
    if (delayCountForList == 2) {
      delayCountForList = 0;
      var setTime = Date.now()
      while (true) {
        if (Date.now() - setTime > 120 * 1000) break;
      }
    }
  }

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
  try {
    var res = await axios.get(
      WAX_BASE_URL + "/list-items-steam",
      {
        params: {
          api: waxPeerApiKey,
          game: "csgo",
        },
      }
    );
  } catch (error) {
    console.log(error)
  }

  lastWaxListingUpdate = Date.now();
  // check if the request was successful
  if (res.status !== 200) {
    error();
    return;
  }
  // parse the response data
  myListedItems = res.data.items;
  //console.log(res.data.items.length);
  var updates = [];
  // Create an array of Promises by mapping over the items and calling actLLAsync
  const promises = myListedItems && myListedItems.map(async item => {
    try {
      itemIdNamePair[item.item_id]=item.name;
      var res = await axios.get(
        WAX_BASE_URL + "/search-items-by-name",
        {
          params: {
            api: waxPeerApiKey,
            game: "csgo",
            names: item.name,
          },
        }
      );
      if (res.status === 200) {
        var itemName = item.name;
        var returnedItems = res.data.items;
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
    } catch { }
  });

  await Promise.all(promises);

  if (updates.length > 0) {
    console.log(`Preparing new row of updates (${updates.length} detected)`);
    var batches = [];
    var full = Math.floor(updates.length / waxUpdateLimit);
    var rem = (updates.length) % waxUpdateLimit;

    for (var i = 0; i < full; i++) {
      batches.push(updates.slice(i * waxUpdateLimit, (i + 1) * waxUpdateLimit));
    }

    if (rem > 0) {
      batches.push(updates.slice(full * waxUpdateLimit),);
    }

    var updated = [];
    var failed = [];

    for (var idx = 0; idx < batches.length; idx++) {
      console.log(`Sending batch of updates ${idx + 1} out of ${batches.length}`)
      var sendItems = batches[idx].map(element => ({
        item_id: element.item_id,
        price: Math.floor(element.price),
      }))
      try {
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
      } catch (error) {
        console.log(error)
      }

      delayCountForUpdate += 1;
      if (res.status !== 200) {
        error();
        continue;
      }
      result = res.data;
      updated = [...updated, ...result.updated];
      failed = [...failed, ...result.failed];

      //console.log(result.updated.length, result.failed.length);
      if (result.failed.length > 0) { console.log(result.failed[0].msg) }

      if (delayCountForUpdate == 2) {//because of wax policy to protect spam, we shoue delay 120 seconds per 2 requests
        delayCountForUpdate = 0;
        var setTime = Date.now()
        while (true) {
          if (Date.now() - setTime > 120 * 1000) break;
        }
      } else {
        var setTime = Date.now()
        while (true) {
          if (Date.now() - setTime > 2 * 1000) break;
        }
      }
    }

    if (updated.length > 0) {
      console.log(`   Success: ${updated.length}`);
      if (showResultDetail) {
        updates.forEach(update => {
          console.log(`      item id is ${itemIdNamePair[update.item_id]} and price is  ${update.price / 1000}`)
        });
      }

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
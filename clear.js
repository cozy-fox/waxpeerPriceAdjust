const fs = require('fs');
const axios = require('axios');

fs.readFile('config.json', (err, data) => {
  const config = JSON.parse(data);
  const wax_api_key = config.waxpeer_api_key;
  const url = 'https://api.waxpeer.com/v1/remove-all';
  const params = {
    api: wax_api_key,
    game: 'csgo'
  };
  axios.get(url, { params })
    .then((response) => {
      const data = response.data;
      if (response.status === 200) {
        console.log(`Result: ${data.msg} (count: ${data.count || 0})`);
      } else {
        console.log(`Error: ${data.msg || ''}`);
      }
    })
    .catch((error) => {
      console.error(error);
    });
});
import express from "express";
import axios from "axios";
import bodyParser from "body-parser";

const app = express();
const port = 3000;

const API_URL_GEOCODING = "http://api.openweathermap.org/geo/1.0/direct";
const API_URL_WEATHERMAP = "https://api.openweathermap.org/data/2.5/forecast/";
const API_KEY = "b16799685e43408dbea1c4eaa5c4c984";

// Ollama configuration
const OLLAMA_URL = "http://localhost:11434/api/generate";
const OLLAMA_MODEL = "llama3:latest"; 

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.render("index.ejs", { result: null, error: null });
});

// Autocomplete route
app.get("/search-cities", async (req, res) => {
  try {
    const query = req.query.q;
    if (!query || query.length < 3) {
      return res.json([]);
    }

    const response = await axios.get(API_URL_GEOCODING, {
      params: {
        q: query,
        limit: 5,
        appid: API_KEY,
      },
    });

    res.json(response.data);
  } catch (error) {
    console.error("Autocomplete Error:", error.message);
    res.status(500).json([]);
  }
});

// Helper function to get AI suggestions from Ollama
async function getWeatherSuggestions(weatherData, city) {
  try {
    // Prepare weather summary for the AI
    const weatherSummary = prepareWeatherSummary(weatherData);
    
    const prompt = `You are a helpful weather advisor. Based on the following weather forecast for ${city}, provide personalized activity suggestions and important things to note.

Weather Forecast Summary:
${weatherSummary}

Please provide:
1. **Things to Note** (1-2 important weather-related warnings or tips)
2. **Suggested Activities** (1-2 activities suitable for this weather)

Keep your response concise, practical, and formatted clearly. Use bullet points.`;

    const response = await axios.post(OLLAMA_URL, {
      model: OLLAMA_MODEL,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.7,
        max_tokens: 500
      }
    });

    return response.data.response;
  } catch (error) {
    console.error("Ollama Error:", error.message);
    return "Unable to generate suggestions at this time. Please check if Ollama is running.";
  }
}

// Helper function to prepare weather summary from forecast data
function prepareWeatherSummary(dailyData) {
  let summary = "";
  
  dailyData.slice(0, 2).forEach(day => {
    const temps = day.hours.map(h => h.main.temp);
    const conditions = day.hours.map(h => h.weather[0].main);
    const avgTemp = (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1);
    const maxTemp = Math.max(...temps).toFixed(1);
    const minTemp = Math.min(...temps).toFixed(1);
    
    // Get most common condition
    const conditionCounts = {};
    conditions.forEach(c => conditionCounts[c] = (conditionCounts[c] || 0) + 1);
    const mainCondition = Object.keys(conditionCounts).reduce((a, b) => 
      conditionCounts[a] > conditionCounts[b] ? a : b
    );
    
    // Check for rain
    const rainHours = day.hours.filter(h => 
      h.weather[0].main.toLowerCase().includes('rain')
    ).length;
    
    summary += `${day.date}:\n`;
    summary += `- Temperature: ${minTemp}°C to ${maxTemp}°C (avg: ${avgTemp}°C)\n`;
    summary += `- Conditions: ${mainCondition}\n`;
    if (rainHours > 0) {
      summary += `- Rain expected for ${rainHours} hour(s)\n`;
    }
    summary += `\n`;
  });
  
  return summary;
}

// Main weather route with AI suggestions
app.post("/get-weather", async (req, res) => {
  const city = req.body.city;
  try {
    // 1. Get Coordinates
    const geoResponse = await axios.get(API_URL_GEOCODING, { 
      params: { q: city, limit: 1, appid: API_KEY } 
    });
    
    if (geoResponse.data.length === 0) {
      return res.render("index.ejs", { 
        error: "City not found", 
        forecast: null 
      });
    }
    
    const { lat, lon, name, country } = geoResponse.data[0];

    // 2. Fetch Hourly Data
    const response = await axios.get(API_URL_WEATHERMAP, {
      params: { lat, lon, appid: API_KEY, units: "metric", cnt: 96 }
    });

    // 3. GROUP BY DATE
    const groupedForecast = {};
    
    response.data.list.forEach(item => {
      const dateKey = new Date(item.dt * 1000).toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'short', 
        day: 'numeric' 
      });
      
      if (!groupedForecast[dateKey]) {
        groupedForecast[dateKey] = [];
      }
      groupedForecast[dateKey].push(item);
    });

    // Convert object to array for EJS
    const dailyData = Object.keys(groupedForecast).map(date => {
      return { date: date, hours: groupedForecast[date] };
    });

    // 4. Get AI suggestions
    console.log("Generating AI suggestions...");
    const aiSuggestions = await getWeatherSuggestions(dailyData, name);

    res.render("index.ejs", { 
      forecast: dailyData, 
      city: name, 
      country: country,
      aiSuggestions: aiSuggestions,
      error: null 
    });

  } catch (error) {
    console.error("Weather fetch error:", error.message);
    res.render("index.ejs", { 
      forecast: null, 
      error: "Error fetching data" 
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Make sure Ollama is running on http://localhost:11434`);
});
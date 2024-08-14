import { APIGatewayProxyHandler } from "aws-lambda";
import axios from "axios";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const s3Client = new S3Client({});
const ssmClient = new SSMClient({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const WEATHER_API_KEY_NAME = process.env.WEATHER_API_KEY_NAME!;
const DEFAULT_LATITUDE = "40.7608";
const DEFAULT_LONGITUDE = "-111.8910"; // Salt Lake City

let cachedApiKey: string | null = null;

const getApiKey = async (): Promise<string> => {
  if (cachedApiKey) {
    return cachedApiKey;
  }

  const parameter = await ssmClient.send(
    new GetParameterCommand({
      Name: WEATHER_API_KEY_NAME,
      WithDecryption: true,
    })
  );

  cachedApiKey = parameter.Parameter?.Value!;
  return cachedApiKey;
};

const getWeatherData = async (
  latitude: number,
  longitude: number
): Promise<any> => {
  const apiKey = await getApiKey();
  const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${latitude}&lon=${longitude}&exclude=minutely,hourly&units=metric&appid=${apiKey}`;

  try {
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error("Error fetching weather data:", error);
    throw error;
  }
};

const saveDataToS3 = async (key: string, data: any): Promise<void> => {
  const params = {
    Bucket: BUCKET_NAME,
    Key: key,
    Body: JSON.stringify(data),
    ContentType: "application/json",
  };

  try {
    await s3Client.send(new PutObjectCommand(params));
    console.log(`Data saved to S3 with key: ${key}`);
  } catch (error) {
    console.error("Error saving data to S3:", error);
    throw error;
  }
};

const getDataFromS3 = async (key: string): Promise<any> => {
  const params = {
    Bucket: BUCKET_NAME,
    Key: key,
  };

  try {
    const data = await s3Client.send(new GetObjectCommand(params));
    return JSON.parse(data.Body?.toString() || "{}");
  } catch (error: any) {
    if (error.name === "NoSuchKey") {
      console.log("No data found in S3 for the given key.");
      return null;
    } else {
      console.error("Error retrieving data from S3:", error);
      throw error;
    }
  }
};

const logUserActivity = async (data: any): Promise<void> => {
  const activityKey = `user-activity/${Date.now()}.json`;

  const params = {
    Bucket: BUCKET_NAME,
    Key: activityKey,
    Body: JSON.stringify(data),
    ContentType: "application/json",
  };

  try {
    await s3Client.send(new PutObjectCommand(params));
    console.log(`User activity logged with key: ${activityKey}`);
  } catch (error) {
    console.error("Error logging user activity:", error);
    throw error;
  }
};

export const handler: APIGatewayProxyHandler = async (event: any) => {
  try {
    const latitude = event.queryStringParameters?.latitude || DEFAULT_LATITUDE;
    const longitude =
      event.queryStringParameters?.longitude || DEFAULT_LONGITUDE;
    const cacheKey = `weather-data/${latitude}-${longitude}.json`;
    let weatherData = await getDataFromS3(cacheKey);

    if (!weatherData) {
      weatherData = await getWeatherData(latitude, longitude);
      await saveDataToS3(cacheKey, weatherData);
    }

    await logUserActivity({
      latitude,
      longitude,
      timestamp: new Date().toISOString(),
      weatherData,
    });

    return {
      statusCode: 200,
      body: JSON.stringify(weatherData),
      headers: {
        "Content-Type": "application/json",
      },
    };
  } catch (error: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Failed to retrieve weather data",
        error: error.message,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    };
  }
};

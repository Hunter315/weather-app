import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { handler } from "./weather";
import {
  APIGatewayProxyEvent,
  Context,
  Callback,
  APIGatewayProxyResult,
} from "aws-lambda";
import axios from "axios";

// Mock axios
jest.mock("axios");

// Mock AWS SDK clients
const ssmMock = mockClient(SSMClient);
const s3Mock = mockClient(S3Client);

describe("weather lambda function", () => {
  const context: Context = {} as any;
  const callback: Callback<APIGatewayProxyResult> = () => {};

  beforeEach(() => {
    jest.clearAllMocks();
    ssmMock.reset();
    s3Mock.reset();

    // Mock SSM getParameter
    ssmMock.on(GetParameterCommand).resolves({
      Parameter: { Value: "mock-api-key" },
    });

    // Mock S3 getObject
    s3Mock.on(GetObjectCommand).callsFake((params) => {
      if (params.Key.includes("weather-data/40.7128--74.006.json")) {
        return {
          Body: JSON.stringify({ temp: 75 }),
        };
      } else {
        throw { name: "NoSuchKey" };
      }
    });

    // Mock S3 putObject
    s3Mock.on(PutObjectCommand).resolves({});
  });

  it("should retrieve weather data from S3 if cached", async () => {
    const event: APIGatewayProxyEvent = {
      queryStringParameters: { latitude: "40.7128", longitude: "-74.006" }, // New York
    } as any;

    const result = (await handler(
      event,
      context,
      callback
    )) as APIGatewayProxyResult;
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.temp).toBe(75);
    expect(s3Mock.commandCalls(GetObjectCommand).length).toBe(1);
  });

  it("should fetch weather data from API if not cached and save it to S3", async () => {
    (axios.get as jest.Mock).mockResolvedValueOnce({ data: { temp: 76 } });
    // Reset the mock specifically for this test to simulate no cached data
    s3Mock.reset();
    s3Mock.on(GetObjectCommand).rejects({
      name: "NoSuchKey",
    });

    const event: APIGatewayProxyEvent = {
      queryStringParameters: { latitude: "34.0522", longitude: "-118.2437" },
    } as any;

    const result = (await handler(
      event,
      context,
      callback
    )) as APIGatewayProxyResult;
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.temp).toBe(76);

    // Identify the user activity PutObjectCommand by checking for "user-activity" in the Key
    const putObjectCalls = s3Mock.commandCalls(PutObjectCommand);
    const userActivityCall = putObjectCalls.find((call) =>
      (call.args[0].input.Key as string).includes("user-activity")
    );

    expect(userActivityCall).toBeDefined();
    const userActivityData = JSON.parse(
      userActivityCall?.args[0].input.Body as string
    );

    expect(userActivityData).toHaveProperty("timestamp");
    expect(userActivityData).toHaveProperty("latitude");
    expect(userActivityData).toHaveProperty("longitude");
    expect(userActivityData.latitude).toBe("34.0522");
    expect(userActivityData.longitude).toBe("-118.2437");
  });

  it("should use default coordinates if no location is provided", async () => {
    // Mock axios.get to return the expected temperature of 75 for default coordinates
    (axios.get as jest.Mock).mockResolvedValueOnce({ data: { temp: 75 } });

    // Mock S3 to return no cached data
    s3Mock.reset();
    s3Mock.on(GetObjectCommand).rejects({
      name: "NoSuchKey",
    });

    const event: APIGatewayProxyEvent = {
      queryStringParameters: {}, // No location provided
    } as any;

    const result = (await handler(
      event,
      context,
      callback
    )) as APIGatewayProxyResult;

    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.temp).toBe(75);
  });

  it("should return a 500 status code if an error occurs", async () => {
    // Mock axios.get to simulate an API error
    (axios.get as jest.Mock).mockRejectedValueOnce(new Error("API Error"));

    // Simulate that S3 cache does not have the weather data
    s3Mock.on(GetObjectCommand).rejects({
      name: "NoSuchKey", // Ensure the handler tries to fetch from API
    });

    const event: APIGatewayProxyEvent = {
      queryStringParameters: { latitude: "34.0522", longitude: "-118.2437" },
    } as any;

    const result = (await handler(
      event,
      context,
      callback
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(500);
    expect(result.body).toContain("Failed to retrieve weather data");
  });
});

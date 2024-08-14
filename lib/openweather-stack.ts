import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { join } from "path";
import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as iam from "aws-cdk-lib/aws-iam";
require("dotenv").config();

export class OpenweatherStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // === S3 HOST ===
    const websiteBucket = new Bucket(this, "WebsiteBucket", {
      websiteIndexDocument: "index.html",
      publicReadAccess: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
    });

    // === SSM Parameter for API Key ===
    const apiKeyParameter =
      ssm.StringParameter.fromSecureStringParameterAttributes(
        this,
        "ApiKeyParameter",
        {
          parameterName: process.env.WEATHER_API_KEY_NAME!,
          version: 1,
        }
      );

    // === LAMBDA ===
    const weatherLambda = new lambda.Function(this, "WeatherFunction", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset(join(__dirname, "../lambda/build")),
      handler: "weather.handler",
      environment: {
        BUCKET_NAME: websiteBucket.bucketName,
        API_KEY_PARAMETER_NAME: apiKeyParameter.parameterName,
      },
    });

    // Grant Lambda access to read the API key from SSM Parameter Store
    apiKeyParameter.grantRead(weatherLambda);

    // Grant Lambda access to read/write to the S3 bucket
    websiteBucket.grantReadWrite(weatherLambda);

    // === API GATEWAY ===
    const api = new apigateway.RestApi(this, "WeatherApi", {
      restApiName: "Weather Service",
      description: "This service fetches weather data.",
    });

    const getWeatherIntegration = new apigateway.LambdaIntegration(
      weatherLambda,
      {
        requestTemplates: { "application/json": '{ "statusCode": "200" }' },
      }
    );

    api.root.addMethod("GET", getWeatherIntegration);
  }
}

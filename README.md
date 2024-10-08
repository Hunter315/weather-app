# Weather App
## Overview
This is a simple app to give current weather conditions and forecasts based on user-provided latitude and longitude coordinates. It also logs user activity to potentially analyze behavior and usage trends. It's built using AWS services such as Lambda, S3, API Gateway, and CDK (Cloud Development Kit).

###### NOTE: The data right now is just the raw data from the OpenWeatherMap API. To make a more robust service, we would create different routes that fetch and return different data responses.  For example, we could make calls just for the current weather, or 4 day forecast. I would put these 2 calls behind a `/current` route and a `/daily` with API Gateway which then adjusts our API call parameters to OpenWeatherMap.

## AWS CDK
I went with AWS CDK for the backend because it simplifies the management of Infrastructure as Code and allows for flexibility without having to meander around in the AWS console to modify resources. I like it especially when you don't have a huge DevOps structured team to back you up.

## Usage
1. ##### User Request:
The user initiates a request to the application through an API Gateway endpoint `https://z8dnmvtp59.execute-api.us-west-1.amazonaws.com/prod?latitude=40.7128&longitude=-74.0060`, providing latitude and longitude as query parameters. If no coordinates are provided, the application uses default coordinates (Salt Lake City, my hometown) to fetch weather data.

2. ##### Request Validation and Processing:
The Lambda function is triggered by the API Gateway. It first checks the provided coordinates to ensure they are valid. If the coordinates are not valid or missing, the function uses the default coordinates.

3. ##### Cache Lookup:
The Lambda function checks S3 to see if the requested weather data for the specific coordinates is already cached.
If cached data exists in S3, the function retrieves this data, skipping the need to call the external weather API.

4. ##### Weather Data Retrieval:

If the data is not found in the cache, the Lambda function makes an external API call to the OpenWeatherMap API using the provided or default coordinates.
The retrieved weather data is then stored in S3 for future requests, effectively caching it.

5. ##### User Activity Logging:

Along with retrieving the weather data, the Lambda function logs the user activity, including the coordinates used, timestamp, and retrieved weather data, to S3. This log is useful for analyzing user behavior and trends.

6. ##### Response Generation:

The Lambda function generates a response containing the weather data (whether from cache or API) and sends it back to the user via API Gateway.

7. ##### Response Delivery:

The user receives the weather data as a JSON response. If any errors occur during the process (e.g., API failure), the Lambda function returns a 500 status code with an error message.


## Discussion / Design Choices

#### Why Cache? And why S3 and not Dynamo?

We want to reduce the number of API calls we make to OpenWeatherMap. Caching will store and reuse recent weather data for the same location. This will help lower API costs and also improve response times. 

###### Cache Expiration: 
My current setup doesn't have cache expiry on it. I would set the cached object in s3 to expire in around 10 mins, because that is how often OpenWeatherMap says they update anyway. We could utilize a metadata tag indicating its expiration time Date.now() plus ten minutes then have the lambda check whether the object is expired before using it.

###### s3 vs Dynamo
They both would work great in this scenario. I chose to use s3 as a sort of caching mechanism because the data is mostly just logs that are static and won't be needing edits.  With storing large objects, s3 is also cheaper. We can also utilize other services to perform data querying, which I will address later. If we needed super complex queries, super-low latency, and high-throughput, then I would consider Dynamo.

Another potential advantage is that s3 can integrate well with Cloudfront for quick global distribution. A weather app shouldn't be too complicated in it's processes so the simple setup and integration of s3 are ideal in my opinion. 

#### Why Lambda?
The weather app needs minimal processing, should be cost effective, and easily integrate with other services. Lambda is great for that since it is scales automatically, is cost-effective, and works with other services well. 

#### Security issues
##### API KEYS
The API is currently not secured with API keys. IT DEFINITELY NEEDS TO BE SECURED WITH API KEYS. This allows for better tracking of individual client data. You would generate an apiKey for each client of the API. Then pass the key in an `x-api-key` header of sorts in the request, ensuring that only perhaps your frontend application can consume the API.

We can also implement Rate Limiting and other such controls on the API this way.

I have API Keys separated from access tokens because I have never personally signed in to a weather app, most of them are free to use without signup.

##### COGNITO AND ACCESS TOKENS
This goes along closely with Api Keys in the way that you can set more authorization parameters on different users. Perhaps there is a tier of Premium features in the app that should only be available to some users.  We want the option of having the access control that Cognito offers. 

A user would be able to sign in via Cognito User Pools, which then issues an access token. That token can then be used in the `Authorization` header. Then you could map different users to different roles in IAM as well to fine-tune the access. 

##### Other
Almost all services we are utilizing are fully managed by AWS and have encryption in transit and at rest, so we don't really need a VPC in this scenario. 

We could use Web Application Firewall to protect against some common attacks.

#### Data Analysis
Since we use s3, we would need to use Athena to query the s3 logs. We could then be able to know where the most popular locations are, the weather condition change stats, and when users are most active. Amazon Quicksight could then help us with creating dashboards and visualization on that data.

We could use AWS Glue to clean the data, then send it to Lake Formation or Redshift for more complex analysis. 



## EDIT: IMPORTANT
Looking back over this before we chat I am thinking that there are some interesting design decisions here to say the least ( I unfortunately got covid, I will attribute it to that :D ). If I were to build this app right now, I would use API Gateway's caching mechanism before hitting the lambda every time. That would speed things up significantly. Then you just have to set your Cache TTL policy and you're good to go. Then there are a few ways you can still capture user data along with this caching, since the requests won't hit the lambda. 

#### Lambda Authorizer
Lambda Authorizers usualyl is for handling auth with a bearer token or some such thing, but we could utilize one in this case to just grab the request parameters and user data to log it. 

#### Cloudwatch
We can utilize Cloudwatch on the API Gateway to see every request coming in and grab the data from there using Cloudwatch Logs: https://docs.aws.amazon.com/apigateway/latest/developerguide/monitoring-cloudwatch.html#:~:text=You%20can%20monitor%20API%20execution%20by%20using%20CloudWatch%2C,how%20your%20web%20application%20or%20service%20is%20performing.

### Another notable mention here should be Redis for caching our content
Since it is in memory, it is high performance and allows for flexbile data structuring.  It is very scalable. Redis is the most robust option of all the proposed items here. I wouldn't use Dynamo or S3, unless I was a startup and REALLY tight on money, since redis can be slightly more expensive in this use-case scenario.

### App Flow
1. Request through API Gateway
2. REquest directed to Lambda Function
3. Check for cache hit in Redis
    - if hit, retrieive data from Redis and return it to API Gateway
    - if miss, fetch the data from OpenWeatherMap API, store it in Redis, return to API Gateway
  
4. Data tracking in Lambda
 - Log requests with lat&lon, timestamp, cache hits/misses in Cloudwatch
 - Store usage data in Redshift or S3 for analysis.


### Further Consideration
##### Handling High traffic scenarios
- Auto Scaling Groups on Lambdas
- Redis caching reduces load on external api
- API Gateway Rate Limiting
- Monitor and Alerting via CloudWatch Alarms to detect early issues
- lat/lon normalization for fewer cache entries and more clustered locations.

##### Cache failures and API failure
 - Implement retries with backoff exponentially in the Lambda Function
 - Consider serving last known good data from redis or s3
 - scale redis using redis clustering to distribute data across multiple nodes
 - eviction policy (might not need this since TTL is only ten minutes, unless this because the most used weather app in the world) on LRU data
 - Consider Multi-AZ replication for failover protection and promote a replica or restore from backup.

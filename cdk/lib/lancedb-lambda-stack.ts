import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Cors, LambdaIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { Architecture, Code, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';
import * as s3express from 'aws-cdk-lib/aws-s3express';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { env } from '../env';

// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class LancedbLambdaStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const api = new RestApi(this, 'RestAPI', {
      restApiName: 'RestAPI',
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
      },
    });

    const cfnDirectoryBucket = new s3express.CfnDirectoryBucket(this, 'MyCfnDirectoryBucket', {
      dataRedundancy: 'SingleAvailabilityZone',
      locationName: env.S3_EXPRESS_LOCATION, //eu-north-1
      bucketName: env.S3_EXPRESS_BUCKET,
    });

    const lancedbAsset = new Asset(this, "lancedb", {
      path: path.join(__dirname, "../../src/layer/lancedb/nodejs.zip"),
    });

    console.log(lancedbAsset.bucket, "bucket")
    console.log(lancedbAsset.s3ObjectKey, "bucketKey")

    const lancedbLayer = new LayerVersion(this, "lancedbLayer", {
      code: Code.fromBucket(lancedbAsset.bucket, lancedbAsset.s3ObjectKey),
      compatibleRuntimes: [Runtime.NODEJS_20_X],
      description: "Layer containing lancedb packages",
    });

    const searchFunction = new NodejsFunction(this, 'SearchFunction', {
      functionName: 'SearchFunction',
      entry: path.join(__dirname, '../../src/lambda/statements', 'search.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      memorySize: 512,
      architecture: Architecture.X86_64,
      timeout: Duration.minutes(15),
      bundling: {
        minify: false,
        externalModules: ["@lancedb/lancedb"],
      },
      layers: [lancedbLayer],
      environment: {
        S3_EXPRESS_BUCKET: env.S3_EXPRESS_BUCKET,
        S3_EXPRESS_REGION: env.S3_EXPRESS_REGION,
        DB_NAME: env.DB_NAM
      },
    });

    searchFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          's3express:ListAllMyDirectoryBuckets',
          's3express:CreateSession',
        ],
        resources: [
          `arn:aws:s3express:${env.CDK_DEFAULT_REGION}:${env.CDK_DEFAULT_ACCOUNT}:bucket/${env.S3_EXPRESS_BUCKET}/*`,
          `arn:aws:s3express:${env.CDK_DEFAULT_REGION}:${env.CDK_DEFAULT_ACCOUNT}:bucket/${env.S3_EXPRESS_BUCKET}`
        ],
      }),
    );

    const statementsResource = api.root.addResource('statements');
    const searchStatementsResource = statementsResource.addResource('search');

    searchStatementsResource.addMethod("POST", new LambdaIntegration(searchFunction));
  }
}

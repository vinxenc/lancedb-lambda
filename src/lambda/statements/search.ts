import type { LambdaInterface } from '@aws-lambda-powertools/commons/types';
import { parser } from '@aws-lambda-powertools/parser';
import { ApiGatewayEnvelope } from '@aws-lambda-powertools/parser/envelopes';
import * as lancedb from "@lancedb/lancedb";
import * as arrow from "apache-arrow";
import type { Context } from 'aws-lambda';
import { z } from 'zod';
import { env } from '../../env';

const TYPE_VALUES = ["INSERT", "SEARCH"] as const;

const statementSchema = z.object({
  date: z.string(),
  price: z.number(),
  content: z.string()
});

type Statement = z.infer<typeof statementSchema>;

const searchStatementSchema = z.object({
  q: z.string().optional().default(''),
  type: z.enum(TYPE_VALUES),
  data: statementSchema.array(),
});

type SearchStatementBody = z.infer<typeof searchStatementSchema>;

let db: lancedb.Connection;
let tbl: lancedb.Table;

class Lambda implements LambdaInterface {
  @parser({ schema: searchStatementSchema, envelope: ApiGatewayEnvelope })
  public async handler(body: SearchStatementBody, context: Context): Promise<any> {
    if (!db) {
      db = await lancedb.connect(
        `s3://${env.S3_EXPRESS_BUCKET}/${env.DB_NAME}`,
        {
          storageOptions: {
            region: env.S3_EXPRESS_REGION,
            s3Express: 'true',
          }
        }
      );
    }

    if (body.type === 'INSERT' && body.data.length) {
      const tableNames = await db.tableNames();
      
      if (!tableNames.includes('statements')) {
        const schema = new arrow.Schema([
          new arrow.Field("date", new arrow.Utf8()),
          new arrow.Field("price", new arrow.Int32()),
          new arrow.Field("content", new arrow.Utf8()),
        ]);
        
        await db.createEmptyTable("statements", schema);
      }

      if (!tbl) {
        tbl = await db.openTable("statements");
      }
      
      await tbl.add(body.data);
      await tbl.createIndex("content", {
        config: lancedb.Index.fts(),
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true })
      };
    }

    if (!tbl) {
      tbl = await db.openTable("statements");
    }
    
    let result: Statement[];

    if (!body.q) {
      result = await tbl
        .query()
        .select(['date', 'price', 'content'])
        .limit(10)
        .toArray();
    }

    console.time('search');
    result = await tbl
      .search(body.q, 'fts')
      .select(['date', 'price', 'content'])
      .limit(10)
      .toArray();
    console.timeEnd('search');
    return {
      statusCode: 200,
      body: JSON.stringify({
        result
      }),
    };;
  }
}

const myFunction = new Lambda();
export const handler = myFunction.handler.bind(myFunction);

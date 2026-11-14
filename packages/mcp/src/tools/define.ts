import type { z } from 'zod';

/**
 * One tool, defined once: what it is called for, what it takes and what it
 * does.
 *
 * The input used to be written twice — as a schema where the server registers
 * the tool and as a type where the tool is implemented. The two drifted: the
 * implementation of `eventgraph_add_node` took `data`, the schema did not
 * mention it, and the SDK dropped the field before the tool ever saw it. Here
 * the type of `run`'s input is derived from the schema, so there is nothing to
 * keep in step.
 */
export interface Tool<Shape extends z.ZodRawShape = z.ZodRawShape, Result = unknown> {
  description: string;
  input: Shape;
  run(input: z.infer<z.ZodObject<Shape>>): Promise<Result>;
}

export const tool = <Shape extends z.ZodRawShape, Result>(definition: Tool<Shape, Result>): Tool<Shape, Result> =>
  definition;

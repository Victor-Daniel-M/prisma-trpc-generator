import { EnvValue, GeneratorOptions } from '@prisma/generator-helper';
import { getDMMF, parseEnvValue } from '@prisma/internals';
import { promises as fs } from 'fs';
import path from 'path';
import pluralize from 'pluralize';
import { generate as PrismaTrpcShieldGenerator } from 'prisma-trpc-shield-generator/lib/prisma-generator';
import { generate as PrismaZodGenerator } from 'prisma-zod-generator/lib/prisma-generator';
import { configSchema } from './config';
import {
  generateBaseRouter,
  generateCreateRouterImport,
  generateProcedure,
  generateRouterImport,
  generateRouterSchemaImports,
  generateShieldImport,
  generatetRPCImport,
  getInputTypeByOpName,
  getTrpcProcedureTypeByOpName,
  resolveModelsComments,
} from './helpers';
import { project } from './project';
import removeDir from './utils/removeDir';
import { capitalizeFirstLetter } from './utils/uncapitalizeFirstLetter';

export async function generate(options: GeneratorOptions) {
  const outputDir = parseEnvValue(options.generator.output as EnvValue);
  const results = configSchema.safeParse(options.generator.config);
  if (!results.success) throw new Error('Invalid options passed');
  const config = results.data;

  await fs.mkdir(outputDir, { recursive: true });
  await removeDir(outputDir, true);

  await PrismaZodGenerator(options);

  let shieldOutputPath: string;
  if (config.withShield) {
    const outputPath = options.generator.output.value;
    shieldOutputPath = (
      outputPath
        .split(path.sep)
        .slice(0, outputPath.split(path.sep).length - 1)
        .join(path.sep) + '/shield'
    )
      .split(path.sep)
      .join(path.posix.sep);

    shieldOutputPath = path.relative(
      path.join(outputPath, 'routers', 'helpers'),
      shieldOutputPath,
    );

    await PrismaTrpcShieldGenerator({
      ...options,
      generator: {
        ...options.generator,
        output: {
          ...options.generator.output,
          value: shieldOutputPath,
        },
      },
    });
  }

  const prismaClientProvider = options.otherGenerators.find(
    (it) => parseEnvValue(it.provider) === 'prisma-client-js',
  );

  const dataSource = options.datasources?.[0];

  const prismaClientDmmf = await getDMMF({
    datamodel: options.datamodel,
    previewFeatures: prismaClientProvider.previewFeatures,
  });

  const modelOperations = prismaClientDmmf.mappings.modelOperations;
  const models = prismaClientDmmf.datamodel.models;
  const hiddenModels: string[] = [];
  resolveModelsComments(models, hiddenModels);
  const createRouter = project.createSourceFile(
    path.resolve(outputDir, 'routers', 'helpers', 'createRouter.ts'),
    undefined,
    { overwrite: true },
  );

  generateBaseRouter(createRouter, config);

  createRouter.formatText({
    indentSize: 2,
  });

  const appRouter = project.createSourceFile(
    path.resolve(outputDir, 'routers', `index.ts`),
    undefined,
    { overwrite: true },
  );

  const trpc = project.createSourceFile(
    path.resolve(outputDir, 'trpc', `index.ts`),
    undefined,
    { overwrite: true },
  );

  trpc.addStatements(`
  import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
  import { AppRouter } from '../routers';
  import {
    SERVER_BACKEND_API_PREFIX,
    SERVER_BACKEND_HOST,
    SERVER_BACKEND_PORT,
  } from '../../../constants';
  import fetch from 'node-fetch';
  import AbortController from 'abort-controller';
  import { SERVER_BACKEND_PROTOCOL } from '../../../constants';
  import * as trpc from '@trpc/server';
  import * as trpcExpress from '@trpc/server/adapters/express';
  import {
    PrismaClient,
    Prisma,
  } from '../../../prisma/node_modules/@prisma/try-oop';
  
  // @ts-ignore
  global.AbortController = AbortController;
  global.fetch = fetch as any;
  
  export const trpcClient = createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: \`\${SERVER_BACKEND_PROTOCOL}://\${SERVER_BACKEND_HOST!}\${SERVER_BACKEND_PORT}/\${SERVER_BACKEND_API_PREFIX}\`,
      }),
    ],
  });
  
  let prisma: PrismaClient = new PrismaClient();
  
  export const createContext = async (
    opts?: trpcExpress.CreateExpressContextOptions
  ) => {
    const req = opts?.req;
    const res = opts?.res;
  
    return {
      prisma,
      req,
      res,
    };
  };
  
  export { prisma, Prisma };
  export type Context = trpc.inferAsyncReturnType<typeof createContext>;
  
  export type TrpcClientType = typeof trpcClient;
  

  `);

  const commands = project.createSourceFile(
    path.resolve(outputDir, 'command', `index.ts`),
    undefined,
    { overwrite: true },
  );

  commands.addStatements(`
  export function commandMethodName() {
    try {
      throw new Error();
    } catch (e) {
      try {
        // second function --> command execute
        return e.stack.split('at ')[4].split(' ')[0].split('.')[1];
      } catch (e) {
        return '';
      }
    }
  }

  export abstract class Command<T> {
    key?: string;
    data?: T;
    execute(data: T): any {}
    setData?(data: T): any {}
    undo(): any {}
    redo(): any {}
    logCommand?() {}
    logAction?() {}
    logActionFailed?() {}
    logActionDone?() {}
  }
  
  export class BaseCommand {
    logCommand() {
      const commandMethodNameString = commandMethodName();
  
      const actionMap: { [key in typeof commandMethodNameString]: string } = {
        execute: 'Executing',
        redo: 'Redoing',
        undo: 'Undoing',
      };
  
      const processName =
        actionMap[commandMethodNameString] || commandMethodNameString;
      const commandName = this.constructor.name;
  
      return { processName, commandName };
    }
  
    logAction() {
      const { processName, commandName } = this.logCommand();
      console.log(\`\${processName} \${commandName}...\`);
    }
  
    logActionFailed() {
      const { processName, commandName } = this.logCommand();
      console.log(\`\${processName} \${commandName} Failed\`);
    }
  
    logActionDone() {
      const { processName, commandName } = this.logCommand();
      console.log(\`\${processName} \${commandName} Done\`);
    }
  }
  
  export class BatchCommand<T> implements Command<any> {
    key: string = 'batch';
    data: T;
    resState: any = {};
    private commands: Command<any>[] = [];
    private completedCommands: Command<any>[] = [];
  
    constructor(commands: Command<any>[], data: T) {
      this.commands = commands;
      this.data = data;
    }
  
    async execute() {
      for (const command of this.commands) {
        const res = await command.execute(this.data);
  
        this.resState = { ...this.resState, ...{ [command.key!]: res } };
  
        this.completedCommands.push(command);
      }
  
      return this.resState;
    }
  
    async undo(): Promise<void> {
      for (const command of this.completedCommands.reverse()) {
        await command.undo();
      }
    }
  
    async redo(): Promise<void> {
      for (const command of this.commands) {
        await command.redo();
      }
    }
  }
  
  `);

  generateCreateRouterImport(appRouter, config.withMiddleware);
  appRouter.addStatements(/* ts */ `
  import { inferRouterInputs, inferRouterOutputs } from '@trpc/server';

  export const appRouter = ${'router'}({`);

  for (const modelOperation of modelOperations) {
    const { model, ...operations } = modelOperation;
    if (hiddenModels.includes(model)) continue;
    const plural = pluralize(model.toLowerCase());
    const hasCreateMany = Boolean(operations.createMany);
    generateRouterImport(appRouter, plural, model);
    const modelRouter = project.createSourceFile(
      path.resolve(outputDir, 'routers', `${model}.router.ts`),
      undefined,
      { overwrite: true },
    );
    const modelCommand = project.createSourceFile(
      path.resolve(outputDir, 'routers', `${model}.command.ts`),
      undefined,
      { overwrite: true },
    );

    modelCommand.addStatements(
      `import { RouteInput } from ".";
      import { BaseCommand, Command } from "../command";
      import { trpcClient } from "../trpc";`,
    );

    generateCreateRouterImport(modelRouter, false);
    generateRouterSchemaImports(
      modelRouter,
      model,
      hasCreateMany,
      dataSource.provider,
    );

    modelRouter.addStatements(/* ts */ `
    import { prisma } from "../trpc";

      export const ${plural}Router = router({`);
    for (const [opType, opNameWithModel] of Object.entries(operations)) {
      const baseOpType = opType.replace('OrThrow', '');

      generateProcedure(
        modelRouter,
        opNameWithModel,
        getInputTypeByOpName(baseOpType, model),
        model,
        opType,
        baseOpType,
      );

      modelCommand.addStatements(/* ts */ `
      export class ${capitalizeFirstLetter(opNameWithModel)}Command<T>
      extends BaseCommand
      implements Command<any>
    {
      constructor(public data?: RouteInput<'${model.toLowerCase()}', '${opNameWithModel}'>) {
        super();
      }
    
      async setData(data: typeof this.data) {
        this.data = data;
      }
    
      async logAction() {
        super.logAction();
      }
    
      async execute() {
        super.logAction();
        return await trpcClient.${model.toLowerCase()}.${opNameWithModel}.${getTrpcProcedureTypeByOpName(
        baseOpType,
      )}(this.data!);
      }
    
      async undo() {
        super.logAction();
      }
    
      async redo() {
        super.logAction();
      }
    }
      `);
    }
    modelRouter.addStatements(/* ts */ `})`);
    modelRouter.formatText({ indentSize: 2 });
    appRouter.addStatements(`${model.toLowerCase()}: ${plural}Router,`);
  }
  appRouter.addStatements(`})
  
  export type AppRouter = typeof appRouter;

  export type TRoute = keyof AppRouter['_def']['procedures'];
  type Input = inferRouterInputs<AppRouter>;
  type Output = inferRouterOutputs<AppRouter>;

  export type RouteInput<
    TRouteName extends TRoute,
    T extends keyof Input[TRouteName]
  > = Input[TRouteName][T];
  export type RouterOutput<
    TRouteName extends TRoute,
    T extends keyof Output[TRouteName]
  > = Output[TRouteName][T];

  `);

  appRouter.formatText({ indentSize: 2 });
  await project.save();
}

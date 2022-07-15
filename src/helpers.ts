import { SourceFile } from 'ts-morph';
import { Config } from './config';
import { uncapitalizeFirstLetter } from './utils/uncapitalizeFirstLetter';

export const generateCreateRouterImport = (
  sourceFile: SourceFile,
  isProtectedMiddleware: boolean,
) => {
  sourceFile.addImportDeclaration({
    moduleSpecifier: './helpers/createRouter',
    namedImports: [
      isProtectedMiddleware ? 'createProtectedRouter' : 'createRouter',
    ],
  });
};

export const generatetRPCImport = (sourceFile: SourceFile) => {
  sourceFile.addImportDeclaration({
    moduleSpecifier: '@trpc/server',
    namespaceImport: 'trpc',
  });
};

export const generateShieldImport = (
  sourceFile: SourceFile,
  shieldOutputPath: string,
) => {
  sourceFile.addImportDeclaration({
    moduleSpecifier: `${shieldOutputPath}/shield`,
    namedImports: ['permissions'],
  });
};

export const generateRouterImport = (
  sourceFile: SourceFile,
  modelNamePlural: string,
  modelNameCamelCase: string,
) => {
  sourceFile.addImportDeclaration({
    moduleSpecifier: `./${modelNameCamelCase}.router`,
    namedImports: [`${modelNamePlural}Router`],
  });
};

export function generateBaseRouter(sourceFile: SourceFile, config: Config) {
  sourceFile.addStatements(/* ts */ `
  import { Context } from '${config.contextPath}';
    
  export function createRouter() {
    return trpc.router<Context>();
  }`);

  const middlewares = [];
  if (config.withMiddleware) {
    middlewares.push(/* ts */ `
    .middleware(({ ctx, next }) => {
      console.log("inside middleware!")
      return next();
    })`);
  }

  if (config.withShield) {
    middlewares.push(/* ts */ `
    .middleware(permissions)`);
  }

  sourceFile.addStatements(/* ts */ `
    export function createProtectedRouter() {
      return trpc
        .router<Context>()
        ${middlewares.join('\r')};
    }`);
}

export function generateProcedure(
  sourceFile: SourceFile,
  name: string,
  typeName: string,
  modelName: string,
  opType: string,
) {
  let input = 'input';
  const nameWithoutModel = name.replace(modelName as string, '');
  switch (nameWithoutModel) {
    case 'findUnique':
      input = '{ where: input.where }';
      break;
    case 'findFirst':
    case 'findMany':
      break;
    case 'deleteOne':
      input = '{ where: input.where }';
      break;
    case 'deleteMany':
    case 'updateMany':
    case 'aggregate':
      break;
    case 'groupBy':
      input =
        '{ where: input.where, orderBy: input.orderBy, by: input.by, having: input.having, take: input.take, skip: input.skip }';
      break;
    case 'createOne':
      input = '{ data: input.data }';
      break;
    case 'updateOne':
      input = '{ where: input.where, data: input.data }';
      break;
    case 'upsertOne':
      input =
        '{ where: input.where, create: input.create, update: input.update }';
      break;
  }
  sourceFile.addStatements(/* ts */ `
  .${getProcedureTypeByOpName(opType)}("${name}", {
    input: ${typeName},
    async resolve({ ctx, input }) {
      const ${name} = await ctx.prisma.${uncapitalizeFirstLetter(
    modelName,
  )}.${opType.replace('One', '')}(${input});
      return ${name};
    },
  })`);
}

export function generateRouterSchemaImports(
  sourceFile: SourceFile,
  name: string,
) {
  sourceFile.addStatements(/* ts */ `
  import { ${name}FindUniqueSchema } from "../schemas/findUnique${name}.schema";
  import { ${name}FindFirstSchema } from "../schemas/findFirst${name}.schema";
  import { ${name}FindManySchema } from "../schemas/findMany${name}.schema";
  import { ${name}CreateSchema } from "../schemas/createOne${name}.schema";
  import { ${name}DeleteOneSchema } from "../schemas/deleteOne${name}.schema";
  import { ${name}UpdateOneSchema } from "../schemas/updateOne${name}.schema";
  import { ${name}DeleteManySchema } from "../schemas/deleteMany${name}.schema";
  import { ${name}UpdateManySchema } from "../schemas/updateMany${name}.schema";
  import { ${name}UpsertSchema } from "../schemas/upsertOne${name}.schema";
  import { ${name}AggregateSchema } from "../schemas/aggregate${name}.schema";
  import { ${name}GroupBySchema } from "../schemas/groupBy${name}.schema";
  `);
}

export const getInputTypeByOpName = (opName: string, modelName: string) => {
  let inputType;
  switch (opName) {
    case 'findUnique':
      inputType = `${modelName}FindUniqueSchema`;
      break;
    case 'findFirst':
      inputType = `${modelName}FindFirstSchema`;
      break;
    case 'findMany':
      inputType = `${modelName}FindManySchema`;
      break;
    case 'createOne':
    case 'createMany':
      inputType = `${modelName}CreateSchema`;
      break;
    case 'deleteOne':
      inputType = `${modelName}DeleteOneSchema`;
      break;
    case 'updateOne':
      inputType = `${modelName}UpdateOneSchema`;
      break;
    case 'deleteMany':
      inputType = `${modelName}DeleteManySchema`;
      break;
    case 'updateMany':
      inputType = `${modelName}UpdateManySchema`;
      break;
    case 'upsertOne':
      inputType = `${modelName}UpsertSchema`;
      break;
    case 'aggregate':
      inputType = `${modelName}AggregateSchema`;
      break;
    case 'groupBy':
      inputType = `${modelName}GroupBySchema`;
      break;
    default:
      console.log({ opName, modelName });
  }
  return inputType;
};

export const getProcedureTypeByOpName = (opName: string) => {
  let procType;
  switch (opName) {
    case 'findUnique':
    case 'findFirst':
    case 'findMany':
    case 'aggregate':
    case 'groupBy':
      procType = 'query';
      break;
    case 'createOne':
    case 'createMany':
    case 'deleteOne':
    case 'updateOne':
    case 'deleteMany':
    case 'updateMany':
    case 'upsertOne':
      procType = 'mutation';
      break;
    default:
      console.log({ opName });
  }
  return procType;
};

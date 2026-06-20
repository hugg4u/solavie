import { Brackets, WhereExpressionBuilder } from 'typeorm';

export class AbacFilterUtil {
  /**
   * Translates a JSON Logic rule expression into a TypeORM Where expression.
   * Useful for Data Filtering based on ABAC policies without fetching all rows.
   *
   * @param qb The TypeORM QueryBuilder or WhereExpressionBuilder
   * @param rule The JSON Logic expression object or string
   * @param userContext The user context object (e.g. { id: 1, department: 'IT' })
   * @param alias The root alias of the entity in QueryBuilder (default: 'entity')
   */
  static applyRuleToQueryBuilder(
    qb: WhereExpressionBuilder,
    rule: unknown,
    userContext: Record<string, unknown>,
    alias: string = 'entity',
  ): void {
    let ruleObj: unknown = rule;
    if (typeof rule === 'string') {
      try {
        ruleObj = JSON.parse(rule);
      } catch {
        return; // Invalid JSON string
      }
    }

    if (!ruleObj || typeof ruleObj !== 'object' || Array.isArray(ruleObj)) {
      qb.andWhere('1 = 0');
      return;
    }

    const ruleRecord = ruleObj as Record<string, unknown>;
    const keys = Object.keys(ruleRecord);
    if (keys.length === 0) {
      qb.andWhere('1 = 0');
      return;
    }

    const operator = keys[0];
    const args = ruleRecord[operator];

    if (!Array.isArray(args)) return;

    const isResourceVar = (val: unknown): boolean => {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const valRecord = val as Record<string, unknown>;
        return (
          typeof valRecord.var === 'string' &&
          valRecord.var.startsWith('resource.')
        );
      }
      return false;
    };

    switch (operator) {
      case '==':
      case '===': {
        let left: unknown = args[0];
        let right: unknown = args[1];
        if (isResourceVar(right) && !isResourceVar(left)) {
          left = args[1];
          right = args[0];
        }
        const { field, paramName } = this.resolveField(left, alias);
        if (field.endsWith('.unknown')) {
          qb.andWhere('1 = 0');
          break;
        }
        const value = this.resolveValue(right, userContext);
        qb.andWhere(`${field} = :${paramName}`, { [paramName]: value });
        break;
      }
      case '!=':
      case '!==': {
        let left: unknown = args[0];
        let right: unknown = args[1];
        if (isResourceVar(right) && !isResourceVar(left)) {
          left = args[1];
          right = args[0];
        }
        const { field, paramName } = this.resolveField(left, alias);
        if (field.endsWith('.unknown')) {
          qb.andWhere('1 = 0');
          break;
        }
        const value = this.resolveValue(right, userContext);
        qb.andWhere(`${field} != :${paramName}`, { [paramName]: value });
        break;
      }
      case 'in': {
        let left: unknown = args[0];
        let right: unknown = args[1];
        if (isResourceVar(right) && !isResourceVar(left)) {
          left = args[1];
          right = args[0];
        }
        const { field, paramName } = this.resolveField(left, alias);
        if (field.endsWith('.unknown')) {
          qb.andWhere('1 = 0');
          break;
        }
        const value = this.resolveValue(right, userContext);
        qb.andWhere(`${field} IN (:...${paramName})`, { [paramName]: value });
        break;
      }
      case 'and': {
        qb.andWhere(
          new Brackets((sub) => {
            args.forEach((subRule: unknown) =>
              this.applyRuleToQueryBuilder(sub, subRule, userContext, alias),
            );
          }),
        );
        break;
      }
      case 'or': {
        qb.andWhere(
          new Brackets((sub) => {
            args.forEach((subRule: unknown) => {
              sub.orWhere(
                new Brackets((orSub) =>
                  this.applyRuleToQueryBuilder(
                    orSub,
                    subRule,
                    userContext,
                    alias,
                  ),
                ),
              );
            });
          }),
        );
        break;
      }
      default:
        // Unknown or unsupported operator, fail closed
        qb.andWhere('1 = 0');
        break;
    }
  }

  private static resolveField(
    arg: unknown,
    alias: string,
  ): { field: string; paramName: string } {
    let fieldName = 'unknown';
    if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
      const argRecord = arg as Record<string, unknown>;
      if (typeof argRecord.var === 'string') {
        const parts = argRecord.var.split('.');
        if (parts[0] === 'resource' && parts.length > 1) {
          fieldName = parts[1];
        } else {
          fieldName = argRecord.var;
        }
      }
    } else if (typeof arg === 'string') {
      fieldName = arg;
    }

    const safeAlias = alias.replace(/[^a-zA-Z0-9_]/g, '');
    const safeFieldName = fieldName.replace(/[^a-zA-Z0-9_]/g, '');
    const safeParamName = `val_${safeFieldName}_${Math.floor(Math.random() * 100000000)}`;
    return { field: `${safeAlias}.${safeFieldName}`, paramName: safeParamName };
  }

  private static resolveValue(
    arg: unknown,
    userContext: Record<string, unknown>,
  ): unknown {
    if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
      const argRecord = arg as Record<string, unknown>;
      if (typeof argRecord.var === 'string') {
        const parts = argRecord.var.split('.');
        if (parts[0] === 'user' && parts.length > 1) {
          return userContext[parts[1]]; // e.g. userContext['department']
        }
        return userContext[argRecord.var];
      }
    }
    return arg;
  }
}

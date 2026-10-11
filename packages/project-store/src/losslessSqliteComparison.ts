/** Caller owns two exclusive pinned connections: source and a verified inspection copy. */
export interface ComparisonDatabase {
    getAllAsync<T>(sql: string, ...params: string[]): Promise<T[]>;
    getEachAsync<T>(sql: string, ...params: string[]): AsyncIterableIterator<T>;
    isInTransactionAsync(): Promise<boolean>;
}
export class SqliteComparisonError extends Error {
    readonly code: "unsupported" | "invalid_result" | "not_pinned" | "mismatch" | "cleanup";
    readonly failures: unknown[];
    constructor(code: SqliteComparisonError["code"], message: string, failures: unknown[] = []) {
        super(message);
        this.name = "SqliteComparisonError";
        this.code = code;
        this.failures = failures;
    }
}
const fail = (code: SqliteComparisonError["code"], message: string): never => {
    throw new SqliteComparisonError(code, message);
};
const same = (left: unknown, right: unknown, message: string) => {
    if (JSON.stringify(left) !== JSON.stringify(right))
        fail("mismatch", message);
};
const quote = (name: string) => {
    if (!name || name.includes("\0"))
        fail("unsupported", "Empty or NUL-containing identifier.");
    return `"${name.replaceAll('"', '""')}"`;
};
const fold = (name: string) => name.replace(/[A-Z]/g, value => value.toLowerCase());
const text = (value: unknown): string => {
    if (typeof value !== "string")
        fail("invalid_result", "Expected SQLite text result.");
    return value as string;
};
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
        fail("invalid_result", "Invalid SQLite metadata integer.");
    }
    return value as number;
};
function cell(value: unknown): string {
    const result = text(value);
    if (!/^(?:n:|i:-?(?:0|[1-9][0-9]*)|[tb]:(?:[0-9A-F]{2})*)$/.test(result)) {
        fail("invalid_result", "Invalid typed SQLite cell.");
    }
    return result;
}
function encoded(expression: string): string {
    return `CASE typeof(${expression}) WHEN 'null' THEN 'n:'
    WHEN 'integer' THEN 'i:' || CAST(${expression} AS TEXT)
    WHEN 'real' THEN 'r:'
    WHEN 'text' THEN 't:' || hex(CAST(${expression} AS BLOB))
    WHEN 'blob' THEN 'b:' || hex(${expression}) ELSE NULL END`;
}
async function pinned(db: ComparisonDatabase) {
    if (await db.isInTransactionAsync() !== true)
        fail("not_pinned", "Comparison requires caller-owned pinned transactions.");
}
async function scalar(db: ComparisonDatabase, sql: string): Promise<unknown> {
    const rows = await db.getAllAsync<Record<string, unknown>>(sql);
    if (rows.length !== 1 || Object.keys(rows[0]).length !== 1)
        fail("invalid_result", "Expected one SQLite scalar.");
    return Object.values(rows[0])[0];
}
type SchemaObject = {
    kind: string;
    name: string;
    owner: string;
    nameBytes: string;
    ownerBytes: string;
    definition: string;
    rootPage: string;
};
type Column = {
    cid: number;
    name: string;
    type: string;
    notNull: number;
    defaultValue: string;
    pk: number;
    hidden: number;
};
type Table = {
    name: string;
    withoutRowid: number;
    strict: number;
    columns: Column[];
    rowid: string | null;
};
type Catalog = {
    engine: string;
    userVersion: number;
    applicationId: number;
    schemaVersion: number;
    encoding: string;
    schema: SchemaObject[];
    tables: Table[];
};
async function verifyScalarTransport(db: ComparisonDatabase) {
    const iterator = db.getEachAsync<Record<string, unknown>>(`SELECT CAST('-0.0' AS REAL) AS negative_zero,
    1.0000000000000002 AS adjacent,5e-324 AS tiny,1e999 AS positive_inf,-1e999 AS negative_inf,
    CAST(9223372036854775807 AS TEXT) AS large_integer;`);
    const failures: unknown[] = [];
    try {
        if (typeof iterator.return !== "function")
            fail("unsupported", "Comparison requires closeable cursors.");
        const first = await iterator.next();
        if (first.done || Object.keys(first.value).length !== 6)
            fail("invalid_result", "Expected one scalar probe row.");
        const value = first.value;
        if (!Object.is(value.negative_zero, -0) || value.adjacent !== 1.0000000000000002 ||
            value.tiny !== Number.MIN_VALUE || value.positive_inf !== Infinity || value.negative_inf !== -Infinity ||
            value.large_integer !== "9223372036854775807")
            fail("unsupported", "SQLite streaming bridge did not preserve scalar probe values.");
        if (!(await iterator.next()).done)
            fail("invalid_result", "Unexpected extra scalar probe row.");
    }
    catch (error) {
        failures.push(error);
    }
    finally {
        await closeIterators([iterator], failures);
    }
    throwFailures(failures);
}
async function closeIterators(iterators: AsyncIterableIterator<Record<string, unknown>>[], failures: unknown[]) {
    for (const iterator of iterators) {
        try {
            if (iterator.return)
                await iterator.return();
        }
        catch (error) {
            failures.push(error);
        }
    }
}
function throwFailures(failures: unknown[]) {
    if (failures.length === 1)
        throw failures[0];
    if (failures.length > 1)
        throw new SqliteComparisonError("cleanup", "Comparison and/or cursor cleanup failed.", failures);
}
async function catalog(db: ComparisonDatabase): Promise<Catalog> {
    await pinned(db);
    await verifyScalarTransport(db);
    const engine = text(await scalar(db, "SELECT sqlite_source_id();"));
    const userVersion = integer(await scalar(db, "PRAGMA main.user_version;"), -2147483648, 2147483647);
    const applicationId = integer(await scalar(db, "PRAGMA main.application_id;"), -2147483648, 2147483647);
    const schemaVersion = integer(await scalar(db, "PRAGMA main.schema_version;"), -2147483648, 2147483647);
    const encoding = text(await scalar(db, "PRAGMA main.encoding;"));
    if (!["UTF-8", "UTF-16le", "UTF-16be"].includes(encoding))
        fail("unsupported", "Unknown SQLite encoding.");
    const rows = await db.getAllAsync<Record<string, unknown>>(`SELECT type,name,tbl_name,
    hex(CAST(name AS BLOB)) AS name_bytes,hex(CAST(tbl_name AS BLOB)) AS owner_bytes,
    ${encoded("sql")} AS definition,${encoded("rootpage")} AS root_page
    FROM main.sqlite_schema ORDER BY name COLLATE BINARY,type COLLATE BINARY;`);
    const schema = rows.map(row => ({ kind: text(row.type), name: text(row.name), owner: text(row.tbl_name),
        nameBytes: text(row.name_bytes), ownerBytes: text(row.owner_bytes), definition: cell(row.definition), rootPage: cell(row.root_page) }));
    if (new Set(schema.map(row => JSON.stringify([row.kind, row.name]))).size !== schema.length)
        fail("invalid_result", "Duplicate schema identities.");
    for (const row of schema) {
        quote(row.name);
        quote(row.owner);
        if (!["table", "view", "index", "trigger"].includes(row.kind))
            fail("unsupported", "Unknown schema object kind.");
        const nameBytes = text(await scalarWithParams(db, "SELECT hex(CAST(? AS BLOB));", row.name));
        const ownerBytes = text(await scalarWithParams(db, "SELECT hex(CAST(? AS BLOB));", row.owner));
        if (nameBytes !== row.nameBytes || ownerBytes !== row.ownerBytes)
            fail("unsupported", "Identifier did not round-trip across SQLite bridge.");
    }
    const tables: Table[] = [];
    for (const entry of schema.filter(row => row.kind === "table")) {
        const kinds = await db.getAllAsync<Record<string, unknown>>(`PRAGMA main.table_list(${quote(entry.name)});`);
        if (kinds.length !== 1)
            fail("unsupported", "Exact SQLite table_list support is required.");
        const info = kinds[0];
        if (info.schema !== "main" || info.name !== entry.name)
            fail("invalid_result", "Wrong main table metadata.");
        if (info.type !== "table")
            fail("unsupported", "Virtual/shadow tables require an explicit preservation adapter.");
        const kind = { count: integer(info.ncol, 1), wr: integer(info.wr, 0, 1), strict: integer(info.strict, 0, 1) };
        const raw = await db.getAllAsync<Record<string, unknown>>(`SELECT cid,name,type,"notnull",pk,hidden,
      ${encoded("dflt_value")} AS default_value FROM pragma_table_xinfo(?, 'main') ORDER BY cid;`, entry.name);
        const columns = raw.map(row => ({ cid: integer(row.cid), name: text(row.name), type: text(row.type),
            notNull: integer(row.notnull, 0, 1), defaultValue: cell(row.default_value), pk: integer(row.pk), hidden: integer(row.hidden, 0, 3) }));
        if (columns.length !== kind.count || columns.some((column, index) => column.cid !== index || column.hidden === 1) ||
            new Set(columns.map(column => fold(column.name))).size !== columns.length)
            fail("unsupported", "Incomplete or hidden column inventory.");
        const names = columns.map(column => fold(column.name));
        columns.forEach(column => quote(column.name));
        const rowid = kind.wr ? null : ["rowid", "_rowid_", "oid"].find(alias => !names.includes(alias));
        if (rowid === undefined)
            fail("unsupported", "All hidden rowid aliases are shadowed.");
        tables.push({ name: entry.name, withoutRowid: kind.wr, strict: kind.strict, columns, rowid: rowid! });
    }
    await pinned(db);
    return { engine, userVersion, applicationId, schemaVersion, encoding, schema, tables };
}
async function scalarWithParams(db: ComparisonDatabase, sql: string, value: string) {
    const rows = await db.getAllAsync<Record<string, unknown>>(sql, value);
    if (rows.length !== 1 || Object.keys(rows[0]).length !== 1)
        fail("invalid_result", "Expected one bound SQLite scalar.");
    return Object.values(rows[0])[0];
}
function tableQuery(table: Table) {
    const names = [...(table.rowid === null ? [] : [table.rowid]), ...table.columns.map(column => column.name)];
    const aliases = names.map((_, index) => `c${index}`);
    const realAliases = names.map((_, index) => `r${index}`);
    return { aliases, realAliases, sql: `SELECT ${names.map((name, index) => {
            const expression = `t.${quote(name)}`;
            return `${encoded(expression)} AS ${quote(aliases[index])},CASE typeof(${expression}) WHEN 'real' THEN ${expression} ELSE NULL END AS ${quote(realAliases[index])}`;
        }).join(",")}
    FROM main.${quote(table.name)} AS t NOT INDEXED ORDER BY ${aliases.map((alias, index) => `${quote(alias)} COLLATE BINARY,${quote(realAliases[index])}`).join(",")};` };
}
function typedRow(row: Record<string, unknown>, aliases: string[], realAliases: string[]) {
    if (Object.keys(row).length !== aliases.length * 2 || [...aliases, ...realAliases].some(alias => !Object.prototype.hasOwnProperty.call(row, alias))) {
        fail("invalid_result", "Comparison row has unexpected columns.");
    }
    return aliases.map((alias, index) => {
        const real = row[realAliases[index]];
        if (row[alias] !== "r:") {
            if (real !== null)
                fail("invalid_result", "Non-real cell has a real payload.");
            return cell(row[alias]);
        }
        if (typeof real !== "number" || Number.isNaN(real))
            fail("invalid_result", "Real payload must be a binary64 number.");
        // Do not stringify REAL numbers: that loses the sign of stored negative zero.
        const buffer = new ArrayBuffer(8);
        new DataView(buffer).setFloat64(0, real as number, false);
        return "r:" + Array.from(new Uint8Array(buffer), value => value.toString(16).padStart(2, "0")).join("");
    });
}
async function compareTable(source: ComparisonDatabase, copy: ComparisonDatabase, table: Table): Promise<number> {
    const query = tableQuery(table);
    const iterators: AsyncIterableIterator<Record<string, unknown>>[] = [];
    const failures: unknown[] = [];
    let rows = 0;
    try {
        iterators.push(source.getEachAsync(query.sql));
        iterators.push(copy.getEachAsync(query.sql));
        if (iterators.some(iterator => typeof iterator.return !== "function"))
            fail("unsupported", "Comparison requires closeable cursors.");
        while (true) {
            const left = await iterators[0].next(), right = await iterators[1].next();
            if (left.done !== right.done)
                fail("mismatch", "Backup row count differs.");
            if (left.done)
                break;
            same(typedRow(left.value, query.aliases, query.realAliases), typedRow(right.value, query.aliases, query.realAliases), "Backup typed row differs.");
            if (!Number.isSafeInteger(++rows))
                fail("unsupported", "Row count exceeds safe result range.");
        }
    }
    catch (error) {
        failures.push(error);
    }
    finally {
        // Always attempt both cursor closes, even if reading or the first close failed.
        await closeIterators(iterators, failures);
    }
    throwFailures(failures);
    return rows;
}
/** Logical typed-row equivalence; not physical artifact identity, admission, or power-loss proof. */
export async function comparePinnedSqliteDatabases(source: ComparisonDatabase, copy: ComparisonDatabase) {
    if (source === copy)
        fail("unsupported", "Source and inspection must be separate connections.");
    const original = await catalog(source), inspection = await catalog(copy);
    // SQLite backup rewrites the destination schema cookie; track drift per handle instead.
    const { schemaVersion: sourceCookie, ...sourceContent } = original;
    const { schemaVersion: copyCookie, ...copyContent } = inspection;
    same(sourceContent, copyContent, "Backup catalog, engine or header differs.");
    let rows = 0;
    for (const table of original.tables) {
        await pinned(source);
        await pinned(copy);
        rows += await compareTable(source, copy, table);
        if (!Number.isSafeInteger(rows))
            fail("unsupported", "Total row count exceeds safe result range.");
    }
    same(original, await catalog(source), "Source catalog changed during comparison.");
    same(inspection, await catalog(copy), "Inspection catalog changed during comparison.");
    return { tables: original.tables.length, schemaObjects: original.schema.length, rows, sourceCookie, copyCookie };
}

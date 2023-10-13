'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as types from './cs2ts/types';

import { parseProperty, CSharpProperty } from "./cs2ts/properties";
import { parseMethod, CSharpMethod, CSharpParameter, parseConstructor, parseRecord } from "./cs2ts/methods";

import { generateProperty, trimMemberName, generateMethod, generateConstructor, generateClass, generateRecord } from "./cs2ts/generators";
import { ExtensionConfig } from "./cs2ts/config";
import { ParseResult } from "./cs2ts/parse";
import compose = require("./cs2ts/compose");
import regexs = require("./cs2ts/regexs");
import { parseXmlDocBlock, generateJsDoc } from "./cs2ts/commentDoc";
import { parseClass } from "./cs2ts/classes";

//#region CS TO TS
interface Match {
    /**Replacement string */
    result: string;
    /**Original index */
    index: number;
    /**Original lenght */
    length: number;
}
type MatchResult = Match | null;

/**Convert a c# automatic or fat arrow property to a typescript property. Returns null if the string didn't match */
const csAutoProperty = csFunction(parseProperty, generateProperty);
/**Convert a C# method to a typescript method signature */
const csRecord = csFunction(parseRecord, generateRecord);
const csMethod = csFunction(parseMethod, generateMethod);
const csConstructor = csFunction(parseConstructor, generateConstructor);
const csCommentSummary = csFunction(parseXmlDocBlock, generateJsDoc);
const csClass = csFunction(parseClass, generateClass);

function csAttribute(code: string): MatchResult {
    var patt = /[ \t]*\[\S*\][ \t]*\r?\n/;
    var arr = patt.exec(code);
    if (arr === null) { return null; }

    return {
        result: "",
        index: arr.index,
        length: arr[0].length
    };
}
function csFunction<T>(parse: (code: string) => ParseResult<T> | null, generate: (value: T, config: ExtensionConfig) => string) {
    return function (code: string, config: ExtensionConfig) {
        const parseResult = parse(code);
        if (!parseResult) {
            return null;
        } else {
            return {
                result: generate(parseResult.data, config),
                index: parseResult.index,
                length: parseResult.length
            } as MatchResult;
        }
    };
}
function csPublicMember(code: string, config: ExtensionConfig): MatchResult {



    var patt = /public\s*(?:(?:abstract)|(?:sealed))?(\S*)\s+(.*)\s*{/;
    var arr = patt.exec(code);

    var tsMembers: { [index: string]: string } = {
        'class': 'interface',
        'struct': 'interface'
    };

    if (arr === null) { return null; }
    var tsMember = tsMembers[arr[1]];
    var name = trimMemberName(arr[2], config);
    return {
        result: `export ${tsMember || arr[1]} ${name} {`,
        index: arr.index,
        length: arr[0].length
    };
}
/**Find the next match */
function findMatch(code: string, startIndex: number, config: ExtensionConfig): MatchResult {
    code = code.substr(startIndex);

    var functions: ((code: string, config: ExtensionConfig) => MatchResult)[] = [
        csRecord,
        csClass,
        csAutoProperty,
        csConstructor,
        csMethod,
        csCommentSummary,
        csAttribute,
        csPublicMember
    ];

    var firstMatch: MatchResult = null;
    for (let i = 0; i < functions.length; i++) {
        var match = functions[i](code, config);
        if (match !== null && (firstMatch === null || match.index < firstMatch.index)) {
            firstMatch = match;
        }
    }

    return firstMatch ? {
        result: firstMatch.result,
        index: firstMatch.index + startIndex,
        length: firstMatch.length
    } : null;
}
function removeSpecialKeywords(code: string): string {
    return code.replace(/\s+virtual\s+/g, ' ').replace(/#nullable\s*(disable|enable)\s*\n/g, '');
}
function removeUsings(code: string): string {
    return code.replace(/using\s+[^;]+;\s*\n/g, '');
}
function getConfiguration(): ExtensionConfig {

    const rawTrimPostfixes = vscode.workspace.getConfiguration('csharp2typescript').get("trimPostfixes") as string | string[];
    const trimPostfixes: string[] = typeof rawTrimPostfixes === "string" ? [rawTrimPostfixes] : rawTrimPostfixes;

    const propertiesToCamelCase = vscode.workspace.getConfiguration('csharp2typescript').get("propertiesToCamelCase") as boolean;
    const recursiveTrimPostfixes = vscode.workspace.getConfiguration('csharp2typescript').get("recursiveTrimPostfixes") as boolean;
    const ignoreInitializer = vscode.workspace.getConfiguration('csharp2typescript').get("ignoreInitializer") as boolean;
    const removeMethodBodies = vscode.workspace.getConfiguration('csharp2typescript').get("removeMethodBodies") as boolean;
    const removeConstructors = vscode.workspace.getConfiguration('csharp2typescript').get("removeConstructors") as boolean;
    const methodStyle = vscode.workspace.getConfiguration('csharp2typescript').get("methodStyle") as ("signature" | "lambda");
    const byteArrayToString = vscode.workspace.getConfiguration('csharp2typescript').get("byteArrayToString") as boolean;
    const dateToDateOrString = vscode.workspace.getConfiguration('csharp2typescript').get("dateToDateOrString") as boolean;
    const removeWithModifier = vscode.workspace.getConfiguration('csharp2typescript').get("removeWithModifier") as string[];
    const removeNameRegex = vscode.workspace.getConfiguration('csharp2typescript').get("removeNameRegex") as string;
    const classToInterface = vscode.workspace.getConfiguration('csharp2typescript').get("classToInterface") as boolean;
    const preserveModifiers = vscode.workspace.getConfiguration('csharp2typescript').get("preserveModifiers") as boolean;
    const removeSpecialKeywords = vscode.workspace.getConfiguration('csharp2typescript').get("removeSpecialKeywords") as boolean;
    const removeUsings = vscode.workspace.getConfiguration('csharp2typescript').get("removeUsings") as boolean;
    const dictionaryToRecord = vscode.workspace.getConfiguration('csharp2typescript').get("dictionaryToRecord") as boolean;

    return {
        propertiesToCamelCase,
        trimPostfixes,
        recursiveTrimPostfixes,
        ignoreInitializer,
        removeMethodBodies,
        removeConstructors,
        methodStyle,
        byteArrayToString,
        dateToDateOrString,
        removeWithModifier,
        removeNameRegex,
        classToInterface,
        preserveModifiers,
        removeSpecialKeywords,
        removeUsings,
        dictionaryToRecord
    };
}
/**Convert c# code to typescript code */
export function cs2ts(code: string, config: ExtensionConfig): string {
    var ret = "";

    if (config.removeSpecialKeywords) {
        code = removeSpecialKeywords(code);
    }

    if (config.removeUsings) {
        code = removeUsings(code);
    }

    var index = 0;
    while (true) {
        var nextMatch = findMatch(code, index, config);
        if (nextMatch === null) { break; }
        //add the last unmatched code:
        ret += code.substr(index, nextMatch.index - index);

        //add the matched code:
        ret += nextMatch.result;

        //increment the search index:
        index = nextMatch.index + nextMatch.length;
    }
    //add the last unmatched code:
    ret += code.substr(index);

    return ret;
}
//#endregion

//#region TS TO CS
const interfaceNameRegex = /(interface|class) ([a-zA-Z0-9_?]+) /g;
const interfaceBodyRegex = /((interface|class) [a-zA-Z0-9_?]+\s*{[\sa-zA-Z0-9_:?;\[\]]+})/g;
const interfaceBodyExportsOnlyRegex = /(export (interface|class) [a-zA-Z0-9_?]+\s*{[\sa-zA-Z0-9_:?;\[\]]+})/g;
const propertyRegex = /([a-zA-Z0-9_?]+\s*:\s*[a-zA-Z_\[\]]+)/g;

interface TsProperty {
    property: string;
    type: string;
}
const typeMappings = {
    string: "string",
    number: "int",
    boolean: "bool",
    any: "object",
    void: "void",
    never: "void",
};
const convertToPascalCase = (str: string) => {
    return str.length >= 2
        ? `${str[0].toUpperCase()}${str.slice(1)}`
        : str.toUpperCase();
};
const csClass1 = (className: string, classProperties: string) => {
    return `
public class ${className} {
    ${classProperties}
}
    `;
};
const csProperty = (propertyName: string, propertyType: string) => {
    const isList = propertyType.includes("[");
    propertyType = propertyType.replace(/\[\]/g, "");

    let csType: string;
    if (Object.keys(typeMappings).includes(propertyType)) {
        csType = typeMappings[propertyType];
    } else {
        csType = convertToPascalCase(propertyType);
    }

    // Convert list to IEnumerable if necessary
    if (isList) {
        csType = `List<${csType}>`;
    }

    const csPropertyName = convertToPascalCase(propertyName);

    return `
    public ${csType} ${csPropertyName} { get; set; }
    `;
};
const convertInterfaceToCSharp = (
    tsInterface: string,
    classPrefix: string,
    classSuffix: string
): string => {
    const interfaceName = `${classPrefix}${extractInterfaceName(
        tsInterface
    )}${classSuffix}`;

    const props = extractProperties(tsInterface);

    const csProps = props
        .map(property => {
            return csProperty(property.property, property.type);
        })
        .join("");

    return csClass1(interfaceName, csProps);
};
const extractInterfaceName = (tsInterface: string): string => {
    interfaceNameRegex.lastIndex = 0;
    let matches = interfaceNameRegex.exec(tsInterface);
    if (!matches || matches.length === 0) {
        return "";
    }
    return matches[matches.length - 1];
};
const extractProperties = (tsInterface: string): TsProperty[] => {
    propertyRegex.lastIndex = 0;

    let matches = tsInterface.match(propertyRegex);
    if (!matches) {
        return [];
    }

    let tsProperties: TsProperty[] = matches.map(match => {
        const components = match.split(":");
        return {
            property: components[0].trim().replace("?", ""),
            type: components[1].trim(),
        };
    });
    return tsProperties;
};
/**Convert typescript code to c# code */
export function ts2cs(
    tsInterfaces: string,
    exportsOnly?: boolean,
    classPrefix?: string,
    classSuffix?: string
): string {
    const matches = exportsOnly
        ? tsInterfaces.match(interfaceBodyExportsOnlyRegex)
        : tsInterfaces.match(interfaceBodyRegex);
    if (!matches) {
        return "";
    }

    return matches
        .map(iface => {
            return convertInterfaceToCSharp(
                iface,
                classPrefix ? classPrefix : "",
                classSuffix ? classSuffix : ""
            );
        })
        .join("");
}
//#endregion

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "csharp2typescript" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    let cs2tsdisposable = vscode.commands.registerCommand('csharp2typescript.cs2ts', () => {
        // The code you place here will be executed every time your command is executed

        var editor = vscode.window.activeTextEditor;
        if (!editor) { return; }

        var selection = editor.selection;
        var text = editor.document.getText(selection);

        editor.edit(e => {
            var config = getConfiguration();
            e.replace(selection, cs2ts(text, config));
        });
    });
    let ts2csdisposable = vscode.commands.registerCommand('csharp2typescript.ts2cs', () => {
        // The code you place here will be executed every time your command is executed

        var editor = vscode.window.activeTextEditor;
        if (!editor) { return; }

        var selection = editor.selection;
        var text = editor.document.getText(selection);

        editor.edit(e => {
            e.replace(selection, ts2cs(text));
        });
    });
    context.subscriptions.push(cs2tsdisposable);
    context.subscriptions.push(ts2csdisposable);
}
// This method is called when your extension is deactivated
export function deactivate() { }
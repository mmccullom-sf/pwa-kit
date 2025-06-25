#!/usr/bin/env node
/*
 * Copyright (c) 2025, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import {McpServer, ResourceTemplate} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {z} from 'zod'
import {AddComponentTool} from '../utils/AddComponentTool.js'
import {InsertExistingComponentTool} from '../utils/InsertExistingComponentTool.js'
import {CreateNewComponentTool} from '../utils/CreateNewComponentTool.js'
import fs from 'fs/promises'
import path from 'path'
import {fileURLToPath} from 'url'
import {StorefrontDevelopmentGuide} from '../utils/pwa-storefront-development-guide.js'
import {HookRecommenderTool} from '../utils/HookRecommenderTool.js'
import process from 'process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

class PwaStorefrontMCPServerHighLevel {
    constructor() {
        // Using McpServer instead of Server
        this.server = new McpServer(
            {
                name: 'pwa-storefront-mcp-server',
                version: '0.1.0'
            },
            {
                capabilities: {
                    tools: {}
                }
            }
        )

        this.addComponentTool = new AddComponentTool()
        this.insertExistingComponentTool = new InsertExistingComponentTool()
        this.CreateNewComponentTool = new CreateNewComponentTool()
        this.hookRecommenderTool = new HookRecommenderTool()

        this.setupTools()

        // 1. Add in-memory session management
        this.sessions = {}
        this.sessionCounter = 1
    }

    setupTools() {
        // Register pwa-developing-guide tool
        this.server.tool(
            StorefrontDevelopmentGuide.name,
            StorefrontDevelopmentGuide.description,
            {},
            StorefrontDevelopmentGuide.fn
        )

        this.server.tool(
            'analyze_code_structure',
            'Analyze JavaScript/React code structure to identify components, imports, and insertion points',
            {
                code: z.string().describe('The JavaScript/React code to analyze')
            },
            async (args) => {
                try {
                    const analysis = this.addComponentTool.analyzeCodeStructure(args.code)
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(
                                    {
                                        analysis,
                                        summary: {
                                            totalImports: analysis.imports.length,
                                            totalComponents: analysis.components.length,
                                            hasReact: analysis.hasReact,
                                            hasNextJs: analysis.hasNextJs,
                                            hasTailwind: analysis.hasTailwind,
                                            insertionPoints: analysis.insertionPoints.length
                                        }
                                    },
                                    null,
                                    2
                                )
                            }
                        ]
                    }
                } catch (error) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({error: error.message}, null, 2)
                            }
                        ],
                        isError: true
                    }
                }
            }
        )

        this.server.tool(
            'insert_existing_component',
            'Insert an existing React component into an existing page',
            {
                componentName: z.string().describe('Component name'),
                targetPage: z.string().describe('Target page name or path'),
                options: z
                    .object({
                        beforeComponentName: z
                            .string()
                            .optional()
                            .describe('Insert before Component name'),
                        afterComponentName: z
                            .string()
                            .optional()
                            .describe('Insert after Component name')
                    })
                    .optional()
            },
            async (args) => {
                try {
                    const modifiedCode = this.insertExistingComponentTool.insertComponentIntoPage(
                        args.targetPage,
                        args.componentName
                    )
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(
                                    {
                                        success: true,
                                        modifiedCode,
                                        componentType: args.componentType,
                                        options: args.options
                                    },
                                    null,
                                    2
                                )
                            }
                        ]
                    }
                } catch (error) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({error: error.message}, null, 2)
                            }
                        ],
                        isError: true
                    }
                }
            }
        )

        this.server.tool(
            'recommend_hooks',
            'Recommends relevant hooks for a given entity (e.g., product, category).',
            {
                entity: z
                    .string()
                    .describe(
                        'The entity to get hook recommendations for (e.g., product, category, basket, customer)'
                    )
            },
            async (args) => {
                try {
                    const recommendations = this.hookRecommenderTool.getRecommendations(args.entity)
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(recommendations, null, 2)
                            }
                        ]
                    }
                } catch (error) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({error: error.message}, null, 2)
                            }
                        ],
                        isError: true
                    }
                }
            }
        )

        this.server.tool(
            'create_new_component',
            'Conversationally collect parameters and create a new React component.',
            {
                sessionId: z.string().optional().describe('Session ID for the conversational flow'),
                answer: z.string().optional().describe('User answer to the current question')
            },
            async (args) => {
                let sessionId = args.sessionId;
                if (!sessionId) {
                    sessionId = `session-interactive-${this.sessionCounter++}`;
                    this.sessions[sessionId] = { step: 1, answers: {} };
                }
                const session = this.sessions[sessionId];
                const {step, answers} = session;
                const answer = args.answer?.trim();
                const next = (question) => ({
                    content: [
                        { type: 'text', text: JSON.stringify({ sessionId, question }) }
                    ]
                });
                const done = (message) => ({
                    content: [
                        { type: 'text', text: JSON.stringify({ sessionId, message }) }
                    ]
                });
                switch (step) {
                    case 1:
                        if (answer) {
                            answers.name = answer;
                            session.step = 2;
                            const defaultDir = process.env.PWA_STOREFRONT_PATH ? process.env.PWA_STOREFRONT_PATH + '/overrides/app/components' : 'overrides/app/components';
                            return next(`Answer yes to use the default directory (${defaultDir}), or specify the full absolute path to use a different directory:`);
                        }
                        return next('What would you like to name your new React component?');
                    case 2:
                        const defaultDir = process.env.PWA_STOREFRONT_PATH ? process.env.PWA_STOREFRONT_PATH + '/overrides/app/components' : 'overrides/app/components';
                        if (answer) {
                            // If user says yes/y/true/1, use defaultDir
                            if (/^(yes|y|true|1)$/i.test(answer)) {
                                answers.location = defaultDir;
                            } else {
                                answers.location = answer;
                            }
                            session.step = 3;
                            return next('Should I also create a test file for this component? (yes/no)');
                        }
                        return next(`Answer yes to use the default directory (${defaultDir}), or specify the full absolute path to use a different directory:`);
                    case 3:
                        if (answer) {
                            answers.createTestFile = /^(yes|y|true|1)$/i.test(answer);
                            session.step = 4;
                            return next('Do you want to provide custom code for the component? (yes/no)');
                        }
                        return next('Should I also create a test file for this component? (yes/no)');
                    case 4:
                        if (answer) {
                            if (/^(yes|y|true|1)$/i.test(answer)) {
                                session.step = 4.5;
                                return next('Please provide the custom code for the component:');
                            } else {
                                answers.customCode = '';
                                session.step = 5;
                                return next('Is this component related to a specific entity (e.g., product, category, basket, customer)? (optional, press enter to skip)');
                            }
                        }
                        return next('Do you want to provide custom code for the component? (yes/no)');
                    case 4.5:
                        if (answer) {
                            answers.customCode = answer;
                            session.step = 5;
                            return next('Is this component related to a specific entity (e.g., product, category, basket, customer)? (optional, press enter to skip)');
                        }
                        return next('Please provide the custom code for the component:');
                    case 5:
                        if (answer) {
                            answers.entityType = answer;
                        } else {
                            answers.entityType = '';
                        }
                        // Call the simple tool with collected answers
                        const tool = new CreateNewComponentTool();
                        tool.componentData = {
                            name: answers.name,
                            location: answers.location,
                            createTestFile: answers.createTestFile !== false,
                            customCode: answers.customCode || '',
                            entityType: answers.entityType || ''
                        };
                        const result = await tool.createComponent();
                        let dataModelDetails = '';
                        let dataModel = null;
                        if (answers.entityType) {
                            // Call getDataModelDocument for the entity
                            const uriHref = `data://data-models/${answers.entityType}`;
                            dataModel = await this.getDataModelDocument(answers.entityType, uriHref);
                            if (dataModel && dataModel.contents && dataModel.contents[0] && dataModel.contents[0].text) {
                                dataModelDetails = `\n\n📄 Data model for entity '${answers.entityType}':\n${dataModel.contents[0].text}`;
                            } else {
                                dataModelDetails = `\n\nℹ️ No data model found for entity '${answers.entityType}'.`;
                            }
                        }
                        session.step = 6;
                        session.dataModel = dataModel;
                        return next((result + dataModelDetails +
                            (answers.entityType && dataModel ?
                                `\n\nWould you like to modify the generated component to present all fields from the '${answers.entityType}' data model? (yes/no)` :
                                '\n\nComponent creation flow complete.')));
                    case 6:
                        if (answer && /^(yes|y|true|1)$/i.test(answer)) {
                            // Generate presentational component code for all fields
                            const dataModel = session.dataModel;
                            let fields = [];
                            try {
                                const modelObj = dataModel && dataModel.contents && dataModel.contents[0] && JSON.parse(dataModel.contents[0].text);
                                if (modelObj && modelObj.properties) {
                                    fields = Object.keys(modelObj.properties);
                                }
                            } catch (e) {}
                            const componentName = answers.name;
                            // Generate simple HTML table for all fields
                            const tableRows = fields.map(f => `            <tr><td>${f}</td><td>{props.${f} || ''}</td></tr>`).join('\n');
                            const propTypesBlock = `\n${componentName}.propTypes = {\n${fields.map(f => `    ${f}: PropTypes.any,`).join('\n')}\n}\n`;
                            const presentationalCode = `import React from 'react';\nimport PropTypes from 'prop-types';\n\nconst ${componentName} = (props) => (\n    <table border=\"1\">\n        <thead><tr><th>Field</th><th>Value</th></tr></thead>\n        <tbody>\n${tableRows}\n        </tbody>\n    </table>\n);\n${propTypesBlock}\nexport default ${componentName};\n`;
                            // Write to component file using fs/promises and path
                            const fsPromises = await import('fs/promises');
                            const pathModule = await import('path');
                            const componentDir = pathModule.join(answers.location, componentName);
                            const componentFile = pathModule.join(componentDir, 'index.jsx');
                            await fsPromises.mkdir(componentDir, {recursive: true});
                            await fsPromises.writeFile(componentFile, presentationalCode, 'utf8');
                            session.step = 7;
                            return next('Would you like to update the test file with some mock data for this data model? (yes/no)');
                        } else {
                            session.step = 99;
                            return done('Component creation flow complete.');
                        }
                    case 7:
                        if (answer && /^(yes|y|true|1)$/i.test(answer)) {
                            // Generate mock data for test file
                            const dataModel = session.dataModel;
                            let fields = [];
                            try {
                                const modelObj = dataModel && dataModel.contents && dataModel.contents[0] && JSON.parse(dataModel.contents[0].text);
                                if (modelObj && modelObj.properties) {
                                    fields = Object.keys(modelObj.properties);
                                }
                            } catch (e) {}
                            const componentName = answers.name;
                            // Create mock data object
                            const mockData = fields.map(f => `    ${f}: 'mock_${f}'`).join(',\n');
                            const testCode = `import React from 'react';\nimport {render} from '@testing-library/react';\nimport ${componentName} from './index.jsx';\n\ndescribe('${componentName}', () => {\n    it('renders with mock data', () => {\n        const mockProps = {\n${mockData}\n        };\n        const { container } = render(<${componentName} {...mockProps} />);\n        expect(container).toMatchSnapshot();\n    });\n});\n`;
                            // Write to test file using fs/promises and path
                            const fsPromises = await import('fs/promises');
                            const pathModule = await import('path');
                            const componentDir = pathModule.join(answers.location, componentName);
                            const testFile = pathModule.join(componentDir, 'index.test.jsx');
                            await fsPromises.writeFile(testFile, testCode, 'utf8');
                            session.step = 99;
                            return done('Component and test file updated with presentational logic and mock data. Flow complete.');
                        } else {
                            session.step = 99;
                            return done('Component creation flow complete.');
                        }
                    case 99:
                        return done('Component creation flow complete.');
                    default:
                        session.step = 1;
                        return next('What would you like to name your new React component?');
                }
            }
        );

        this.server.resource(
            'data-model',
            new ResourceTemplate('data://data-models/{modelName}', {}),
            {
                title: 'Commerce Cloud Data Model',
                description: 'Commerce Cloud Data Model, such as Product, Category, Order, etc.'
            },
            async (uri, {modelName}) => {
                return this.getDataModelDocument(modelName, uri.href)
            }
        )

        this.server.tool(
            'get_data_model',
            'Get the schema of a data model',
            {
                modelName: z
                    .string()
                    .describe('The name of the data model (e.g., Product, Category, etc.)')
            },
            async ({modelName}) => {
                const uriHref = `data://data-models/${modelName}`
                const result = await this.getDataModelDocument(modelName, uriHref)
                return {
                    content: result.contents.map((item) => ({
                        type: 'text',
                        text: item.text
                    }))
                }
            }
        )
    }

    async getDataModelDocument(modelName, uriHref) {
        try {
            const __filename = fileURLToPath(import.meta.url)
            const __dirname = path.dirname(__filename)
            const dataDir = path.join(__dirname, '..', 'data')
            const filePath = path.join(dataDir, `${modelName}Document.json`)
            let fileContent
            try {
                fileContent = await fs.readFile(filePath, 'utf8')
            } catch (err) {
                if (err.code === 'ENOENT') {
                    fileContent = JSON.stringify({message: `No document found for ${modelName}`})
                } else {
                    throw err
                }
            }
            return {
                contents: [
                    {
                        uri: uriHref,
                        text: fileContent
                    }
                ]
            }
        } catch (error) {
            return {
                contents: [
                    {
                        uri: uriHref,
                        text: JSON.stringify({error: error.message}, null, 2)
                    }
                ]
            }
        }
    }

    async run() {
        const transport = new StdioServerTransport()
        await this.server.connect(transport)
        console.error('PWA Storefront MCP server (McpServer version) running on stdio')
    }
}

const server = new PwaStorefrontMCPServerHighLevel()
server.run().catch(console.error)

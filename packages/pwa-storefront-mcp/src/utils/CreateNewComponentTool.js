/*
 * Copyright (c) 2025, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import fs from 'fs/promises'
import path from 'path'
import {HookRecommenderTool} from './HookRecommenderTool.js'

export const getCopyrightHeader = () => {
    const year = new Date().getFullYear()
    return `/*
 * Copyright (c) ${year}, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */`
}

// Utility to infer entity from component name
function inferEntityFromComponentName(componentName) {
    const name = componentName.toLowerCase()
    if (name.includes('customer')) return 'customer'
    if (name.includes('product')) return 'product'
    if (name.includes('basket')) return 'basket'
    if (name.includes('category')) return 'category'
    return null
}

export class CreateNewComponentTool {
    constructor() {
        this.currentStep = 0
        this.componentData = {
            name: null,
            location: null,
            createTestFile: null,
            customCode: null,
            entityType: null
        }
    }

    /**
     * Starts the component creation process by asking for the component name
     * @returns {string} The first question to ask the developer
     */
    startComponentCreation() {
        this.currentStep = 1
        return 'What would you like to name the new React component?'
    }

    /**
     * Processes the component name, detects the project root, and asks for confirmation
     * @param {string} componentName - The name provided by the developer
     * @returns {Promise<string>} The next question to ask
     */
    async processComponentName(componentName) {
        this.componentData.name = componentName
        // Detect project root
        const projectRoot = await this.detectProjectRoot()
        this.componentData.detectedProjectRoot = projectRoot
        this.currentStep = 2
        return `Detected project root directory: ${projectRoot}\nIs this correct? (yes/no)`
    }

    /**
     * Processes the project root confirmation and asks for the location if not confirmed
     * @param {string} answer - The user's confirmation (yes/no)
     * @returns {string} The next question to ask
     */
    processProjectRootConfirmation(answer) {
        // Always prompt for the full absolute path to the directory where the component should be created
        this.currentStep = 2.5
        return 'Please specify the full absolute path to the directory where the component should be created:'
    }

    /**
     * Processes the custom location if the user did not confirm the detected root
     * @param {string} location - The custom location provided by the developer
     * @returns {string} The next question to ask
     */
    processCustomLocation(location) {
        this.componentData.location = location
        this.currentStep = 3
        return 'Should I also create a test file for this component? (yes/no)'
    }

    /**
     * Processes the test file decision and asks about custom code
     * @param {string} answer - The developer's answer (yes/no)
     * @returns {string} The next question to ask
     */
    processTestFileDecision(answer) {
        this.componentData.createTestFile =
            answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y'
        this.currentStep = 4
        return 'Do you want to provide custom code for the component, or should I use the default skeleton?'
    }

    /**
     * Processes the custom code decision and asks about entity type
     * @param {string} answer - The developer's answer about custom code
     * @returns {string} The next question to ask
     */
    processCustomCodeDecision(answer) {
        if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
            this.currentStep = 4.5 // Special step for custom code input
            return 'Please provide the custom code for the component:'
        } else {
            this.componentData.customCode = null
            this.currentStep = 5
            return 'Is this component related to a specific entity (e.g., product, category, basket, customer), or should I infer it from the name?'
        }
    }

    /**
     * Processes the custom code input and asks about entity type
     * @param {string} customCode - The custom code provided by the developer
     * @returns {string} The next question to ask
     */
    processCustomCode(customCode) {
        this.componentData.customCode = customCode
        this.currentStep = 5
        return 'Is this component related to a specific entity (e.g., product, category, basket, customer), or should I infer it from the name?'
    }

    /**
     * Processes the entity type decision and creates the component
     * @param {string} answer - The developer's answer about entity type
     * @returns {Promise<string>} The result of component creation
     */
    async processEntityTypeDecision(answer) {
        if (answer.toLowerCase() === 'infer' || answer.toLowerCase() === 'auto') {
            this.componentData.entityType = inferEntityFromComponentName(this.componentData.name)
        } else {
            this.componentData.entityType = answer.toLowerCase()
        }

        this.currentStep = 6
        return await this.createComponent()
    }

    /**
     * Creates the component based on all collected data
     * @returns {Promise<string>} The result of component creation
     */
    async createComponent() {
        const messages = []

        // Use the provided absolute path directly if available
        const location = this.componentData.location
        const componentMessage = await this.createComponentFile(
            this.componentData.name,
            location,
            this.componentData.customCode
        )
        messages.push(componentMessage)

        // Create test file if requested
        if (this.componentData.createTestFile) {
            const testMessage = await this.createTestFile(this.componentData.name, location)
            messages.push(testMessage)
        }

        // Handle entity type information
        if (this.componentData.entityType) {
            messages.push(
                `\nℹ️ Entity type '${this.componentData.entityType}' ${
                    inferEntityFromComponentName(this.componentData.name)
                        ? 'was inferred'
                        : 'was specified'
                } for component '${this.componentData.name}'.`
            )
        } else {
            messages.push(
                `\nℹ️ No entity type was specified or could be inferred for component '${this.componentData.name}'.`
            )
        }

        // Recommend hooks if entity is available
        if (this.componentData.entityType) {
            const recommender = new HookRecommenderTool()
            const recommendations = recommender.getRecommendations(this.componentData.entityType)
            if (Array.isArray(recommendations)) {
                messages.push(
                    `\n🔗 Recommended hooks for entity '${this.componentData.entityType}':`
                )
                recommendations.forEach((hook) => {
                    messages.push(`- ${hook.name}: ${hook.description} (from ${hook.package})`)
                })
            } else if (recommendations.error) {
                messages.push(`\n${recommendations.error}`)
            }
        } else {
            messages.push('\nℹ️ No entity provided or inferred for hook recommendations.')
        }

        // Always append lint reminder
        messages.push(
            "\n💡 After creating or modifying a component, run 'npm run lint -- --fix' to automatically fix formatting and linter issues."
        )

        // Reset for next use
        this.reset()

        return messages.join('\n')
    }

    /**
     * Resets the tool state for the next component creation
     */
    reset() {
        this.currentStep = 0
        this.componentData = {
            name: null,
            location: null,
            createTestFile: null,
            customCode: null,
            entityType: null
        }
    }

    /**
     * Gets the current step number
     * @returns {number} The current step
     */
    getCurrentStep() {
        return this.currentStep
    }

    /**
     * Creates a new React component file.
     * @param {string} componentName - Name for the new component.
     * @param {string} projectDir - The absolute path to the project directory for the new component.
     * @param {string} [componentCode] - Code of the component to create. If not provided, a default skeleton will be used.
     */
    async createComponentFile(componentName, projectDir, componentCode) {
        const componentDir = path.join(projectDir, componentName)
        try {
            await fs.mkdir(componentDir, {recursive: true})
            // Create component file
            const componentFilePath = path.join(componentDir, 'index.jsx')
            const codeToWrite =
                !componentCode || componentCode === 'default skeleton'
                    ? `${getCopyrightHeader()}
import React from 'react';

const ${componentName} = () => {
  return (
    <div>${componentName} component</div>
  );
};

export default ${componentName};
`
                    : componentCode
            await fs.writeFile(componentFilePath, codeToWrite, 'utf-8')
            return `✅ Created ${componentFilePath}`
        } catch (err) {
            console.error('Error during file creation:', err);
            return `❌ Error creating component file at ${componentDir}: ${err.message}`
        }
    }

    /**
     * Creates a test file for an existing component.
     * @param {string} componentName - Name of the component to create a test file for.
     * @param {string} projectDir - The absolute path to the project directory where the component exists.
     */
    async createTestFile(componentName, projectDir) {
        const componentDir = path.join(projectDir, componentName)
        try {
            // Create test file
            const testFilePath = path.join(componentDir, 'index.test.jsx')
            const testCode = `${getCopyrightHeader()}
import React from 'react'
import {screen} from '@testing-library/react'
import {renderWithProviders} from '@salesforce/retail-react-app/app/utils/test-utils'
import ${componentName} from './index'

describe('${componentName}', () => {
    test('renders correctly', () => {
        renderWithProviders(<${componentName} />)
        expect(screen.getByText('${componentName} component')).toBeInTheDocument()
    })
})
`
            await fs.writeFile(testFilePath, testCode, 'utf-8')
            return `✅ Created ${testFilePath}`
        } catch (err) {
            console.error('Error during test file creation:', err);
            return `❌ Error creating test file at ${componentDir}: ${err.message}`
        }
    }

    /**
     * Legacy method for backward compatibility - creates a new React component and optionally a test file, then recommends hooks.
     * @param {string} componentName - Name for the new component.
     * @param {string} projectDir - The absolute path to the project directory for the new component.
     * @param {boolean} createTestFile - Whether to create a test file.
     * @param {string} [componentCode] - Code of the component to create.
     * @param {string} [entity] - The entity type for hook recommendations (e.g., product, category, basket, customer).
     */
    async createNewComponent(componentName, projectDir, createTestFile, componentCode, entity) {
        const messages = []
        const componentMessage = await this.createComponentFile(
            componentName,
            projectDir,
            componentCode
        )
        messages.push(componentMessage)

        if (createTestFile) {
            const testMessage = await this.createTestFile(componentName, projectDir)
            messages.push(testMessage)
        }

        // Infer entity if not provided
        let usedEntity = entity
        if (!usedEntity) {
            usedEntity = inferEntityFromComponentName(componentName)
            if (usedEntity) {
                messages.push(
                    `\nℹ️ Entity type '${usedEntity}' was inferred from component name '${componentName}'.`
                )
            } else {
                messages.push(
                    `\nℹ️ No entity could be inferred from component name '${componentName}'.`
                )
            }
        }

        // Recommend hooks if entity is available
        if (usedEntity) {
            const recommender = new HookRecommenderTool()
            const recommendations = recommender.getRecommendations(usedEntity)
            if (Array.isArray(recommendations)) {
                messages.push(`\n🔗 Recommended hooks for entity '${usedEntity}':`)
                recommendations.forEach((hook) => {
                    messages.push(`- ${hook.name}: ${hook.description} (from ${hook.package})`)
                })
            } else if (recommendations.error) {
                messages.push(`\n${recommendations.error}`)
            }
        } else {
            messages.push('\nℹ️ No entity provided or inferred for hook recommendations.')
        }

        // Always append lint reminder
        messages.push(
            "\n💡 After creating or modifying a component, run 'npm run lint -- --fix' to automatically fix formatting and linter issues."
        )

        return messages.join('\n')
    }

    /**
     * Creates a component from a schema-driven answers object
     * @param {object} answers - The answers object with keys matching the schema
     * @returns {Promise<string>} The result of component creation
     */
    async createComponentFromAnswers(answers) {
        // Map schema-driven answers to internal fields
        this.componentData.name = answers.componentName || null
        this.componentData.location = answers.location || null
        this.componentData.createTestFile =
            typeof answers.createTestFile === 'string'
                ? ['yes', 'y', 'true', '1'].includes(answers.createTestFile.toLowerCase())
                : !!answers.createTestFile
        this.componentData.customCode = answers.customCode || null
        this.componentData.entityType = answers.entityType || null
        // If entityType is 'infer' or not provided, infer from name
        if (
            !this.componentData.entityType ||
            this.componentData.entityType === 'infer' ||
            this.componentData.entityType === 'auto'
        ) {
            this.componentData.entityType = inferEntityFromComponentName(this.componentData.name)
        }
        const message = await this.createComponent()
        return {message}
    }

    /**
     * Updates the component file to be a presentational component for the given data model.
     * @param {string} entityType - The entity type (e.g., 'product').
     * @param {string} componentName - The component name.
     * @param {string} location - The absolute path to the component's parent directory.
     * @param {object} dataModel - The data model schema (properties object).
     */
    async updateComponentToPresentational(entityType, componentName, location, dataModel) {
        const componentDir = path.join(location, componentName)
        await fs.mkdir(componentDir, {recursive: true})
        const componentFilePath = path.join(componentDir, 'index.jsx')
        // Generate JSX for all fields
        const fields = Object.keys(dataModel)
        const propName = entityType
        const jsxFields = fields
            .map((field) =>
                `        <div>${field}: {{{propName}.${field}?.toString?.() ?? ''}}</div>`.replace(
                    /\{propName/g,
                    propName
                )
            )
            .join('\n')
        const code = `${getCopyrightHeader()}
import React from 'react';

const ${componentName} = ({{ ${propName} }}) => (
    <div>
${jsxFields}
    </div>
);

export default ${componentName};
`
        await fs.writeFile(componentFilePath, code, 'utf-8')
        return `✅ Updated ${componentFilePath} to presentational component for ${entityType}`
    }

    /**
     * Handles developer's hook selection and updates the component accordingly.
     * @param {string} selectedHook - The hook selected by the developer (e.g., 'useProduct').
     * @param {string} entityType - The entity type (e.g., 'product').
     * @param {string} componentName - The component name.
     * @param {string} location - The absolute path to the component's parent directory.
     * @param {object} dataModels - An object mapping entity types to their data model schemas.
     */
    async handleHookSelection(selectedHook, entityType, componentName, location, dataModels) {
        // For now, only support 'useProduct' and 'product' entity
        if (selectedHook === 'useProduct' && entityType === 'product' && dataModels.product) {
            return await this.updateComponentToPresentational(
                'product',
                componentName,
                location,
                dataModels.product.properties
            )
        }
        // Add more hook/entity support as needed
        return 'Selected hook/entity not supported for presentational generation.'
    }
}

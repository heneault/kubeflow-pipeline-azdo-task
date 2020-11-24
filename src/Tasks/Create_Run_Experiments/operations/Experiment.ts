import path = require("path");
import fs = require("fs");
import task = require("azure-pipelines-task-lib/task");
import * as rest from "typed-rest-client";
import { request, OutgoingHttpHeaders } from "http";
import { IAllExperiment } from "./interfaces"

export class Experiment {
    public endpointUrl: string;
    public name: string;
    public description: string;
    public getAllExperimentsEndpoint: string;
    public restAPIClient: rest.RestClient;
    private bearerToken: string;
    private userId: string;
    private namespace: string;

    constructor() {
        this.endpointUrl = task.getInput('kubeflowEndpoint', true)!;
        // strip trailing backslash
        this.endpointUrl = this.endpointUrl.replace(/\/$/,"");
        this.name = task.getInput('experimentName', true)!;
        this.description = task.getInput('experimentDescription', false)!;
        this.getAllExperimentsEndpoint = '/pipeline/apis/v1beta1/experiments';
        this.restAPIClient = new rest.RestClient('agent');
        this.bearerToken = task.getInput('bearerToken', false)!;
        this.userId = task.getInput('userId', false)!;
        this.namespace = task.getInput('namespace', false)!;
    }

    private getAuthenticationHeader()
    {
        if (this.userId != undefined && this.userId != null) {
            return {'kubeflow-userid': `${this.userId}`}
        }
        else if (this.bearerToken != undefined && this.bearerToken != null) {
            return { 'authorization': `Bearer ${this.bearerToken}` }
        }
        else {
            throw new Error('either userId or bearerToken must be set.');
        }
    }

    public async validateEndpointUrl() {
        try {
            var options: rest.IRequestOptions = { additionalHeaders: this.getAuthenticationHeader() };
            task.debug(`Validating endpoint url ${this.endpointUrl}`);
            var req = await this.restAPIClient.get(this.endpointUrl, options);
            if (req.statusCode == 200) {
                return true;
            }
            return false;
        }
        catch (error) {
            task.setResult(task.TaskResult.Failed, error.message);
        }
    }

    public async validateName() {
        try {
            var url = `${this.endpointUrl}${this.getAllExperimentsEndpoint}`;
            var options: rest.IRequestOptions = { 
                additionalHeaders: this.getAuthenticationHeader()
            };
            if (this.namespace != undefined && this.namespace != null) {
                options.queryParameters =  {
                    params: {
                        'resource_reference_key.type': 'NAMESPACE',
                        'resource_reference_key.id': 'common'
                    }                
                }
            }            
            task.debug(`Loading experiment names from ${url}`);
            var webRequest = await this.restAPIClient.get<IAllExperiment>(url, options)!;
            if (webRequest.result != null) {
                if (webRequest.result.experiments != undefined) {
                    for (var exp of webRequest.result.experiments) {
                        if (exp.name == this.name) {
                            return false;
                        }
                    }
                    return true;
                }
                else {
                    return true;
                }
            }
            else {
                throw new Error('Request did not go through. Make sure your Url is valid, and that you have the correct bearer token, if needed.');
            }
        }
        catch (error) {
            task.setResult(task.TaskResult.Failed, error.message);
        }
    }

    public async runValidations() {
        try {
            if (!await this.validateEndpointUrl()) {
                throw new Error('Endpoint Url must be a valid Url.')
            }
            if (!await this.validateName()) {
                throw new Error('Experiment name field is either empty, or experiment name is already in use.');
            }
            return true;
        }
        catch (error) {
            task.setResult(task.TaskResult.Failed, error.message);
        }
    }

    //The payload that posting a new experiment takes follows this format as a string: {name: string, description: string}
    public async createExperiment() {
        try {
            var form = { "name": this.name }
            if (this.description != undefined && this.description != null) {
                Object.assign(form, {"description": this.description});
            }
            if (this.namespace != undefined && this.namespace != null) {
                Object.assign(form, {"resource_references": [
                    {
                        "key": {
                            "type": "NAMESPACE",
                            "id": `${this.namespace}`
                        },
                        "relationship": "OWNER"
                    }
                ]});
            }

            var url = new URL(this.endpointUrl);
            var reqHost = url.hostname;
            var reqPort = Number.parseInt(url.port) > 0 ? Number.parseInt(url.port) : (url.protocol == 'https:' ? 443 : 80);

            var reqHeaders = {
                'content-type': 'application/json'
            }
            Object.assign(reqHeaders, this.getAuthenticationHeader());
            await this.postRequest(reqHost, reqPort, JSON.stringify(form), reqHeaders);
        }
        catch (error) {
            task.setResult(task.TaskResult.Failed, error.message);
        }
    }

    public async postRequest(reqHost: string, reqPort: number, form: string, reqHeaders: OutgoingHttpHeaders) {
        task.debug(`Posting experiment request to ${this.endpointUrl}${this.getAllExperimentsEndpoint}`)
        var req = request(
            {
                host: reqHost,
                path: `${this.getAllExperimentsEndpoint}`,
                method: 'POST',
                headers: reqHeaders,
                port: reqPort
            },
            response => {
                try {
                    response.on('data', d => {
                        process.stdout.write(d);
                    })
                    console.log(`Response returned with status code ${response.statusCode}: ${response.statusMessage}`);
                }
                catch (error) {
                    task.setResult(task.TaskResult.Failed, `${error.message} Make sure that your endpoint is correct, and that you are using the correct bearer token, if neccessary.`);
                }
            }
        );
        req.write(form);
        req.end();
    }
}
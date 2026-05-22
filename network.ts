import * as aws from "@pulumi/aws";

export interface NetworkArgs {
    sshCidr: string;
}

export interface Network {
    securityGroup: aws.ec2.SecurityGroup;
}

export function createNetwork(name: string, args: NetworkArgs): Network {
    const sg = new aws.ec2.SecurityGroup(`${name}-sg`, {
        description: "Hermes Agent host: SSH in, all out",
        ingress: [{
            protocol: "tcp",
            fromPort: 22,
            toPort: 22,
            cidrBlocks: [args.sshCidr],
            description: "SSH",
        }],
        egress: [{
            protocol: "-1",
            fromPort: 0,
            toPort: 0,
            cidrBlocks: ["0.0.0.0/0"],
            description: "All egress",
        }],
    });

    return { securityGroup: sg };
}

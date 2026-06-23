declare module 'africastalking' {
  interface SMSOptions {
    to: string[];
    message: string;
    from?: string;
  }

  interface SMSResult {
    SMSMessageData: {
      Message: string;
      Recipients: Array<{
        statusCode: number;
        number: string;
        status: string;
        cost: string;
        messageId: string;
      }>;
    };
  }

  interface SMS {
    send(opts: SMSOptions): Promise<SMSResult>;
  }

  interface ATInstance {
    SMS: SMS;
  }

  function AfricasTalking(config: { username: string; apiKey: string }): ATInstance;
  export = AfricasTalking;
}

Subscription floW
Lets implement subscription. check what has been done against this new flow to decide how to proceed. The new flow logs the user in after successful sign up and navigates to the profile page which shows the subscription plans available. when the user selects a plan the payment process for the available process kicks in. on successful payment user is redirected to dashboard page. When user clicks the logout or any other page before he subscribes, a modal offering 8 days free trial should be displayed.

Dashboard 
 Only users who are subscribed or on a trial can view the dashboard page. after subscription when a user clicks go to dashboard user should be navigated here. when a user logs in successfully user should be navigated to the dashboard. when the user gets to the dashboard, the app should check if gps, audio and sos pin is set in that order. if none is set a modal asking the user to set should be displayed for each not set. the gps and audio modal should take the user to the exact setting in the phone to enable the feature. sos pin setting should display a modal to quickly set sos pin. if all setting has been done the user current location should be shown in the map. User mode value : Always on and Trip mode should be gotten from the users plan and the appropriate one selected. my safety circle section should display not more than 2 circle details if they exist or an empty state with an add a circle member button visible. History section should show trips and alerts and empty state when no history yet. family groups should show when in  elite plan otherwise an upgrade to eLITE plan should be displayed instead. if a user is elite and has not set family group an empty state to add family group should be displayed. if family group exists, not more than 2 family groups with a view all should be shown

 Dashboard - Add a circle member
 On clicking the add a circle member, user should be redirected to the circles page and a add a circle modal should be displayed. The modal should contain Full name, phone number and email(optional) and Add to Circle button. on adding the circle sucessfully a notification should be displayed saying circle member added successfully. errors should be displayed if any is not met

 Dashboard - Add a trip

 when the add a trip button is clicked, a add a trip modal should be displayed. On filling the form with valid data and clicking add trip the trip should be added and toast notification displayed.gps monitoring should start and when user is not at the set destination at the ETA, a ringing tone should be triggered to the phone if auto alert is toggled off but if its toggled on, an sos alert is sent seilently  to the circle members tied to the trip. For scenario where the auto sos is toggled off and the ringing tone has been triggered, a modal will be shown with 2 options Trigger sos or arrived safely. on clicking arrive safely the trip enters, added to history and no sos is sent to circle members. but on clicking sos, alerts are sent to all circle members tied to the trip.


History : this page shows sos alerts and trips. it has a filter and search functionality and also a delete functionality


User mode 
 the user modes has 2 options the always on and the trip mode. the always on means there is constant tracking of the user which allows the user to use features of the app such as sos, follow me, fake call anytime. it also allows auto sos when an accident occurs. trip mode requires the user to set a destination and eta for the tracking to happen. gps monitoring will only happen in trip mode when a trip is set not before. if a trip is not set no monitoring happens. user can set a trip when in always on mode but user cannot have constant monitoring when in trip mode. Always on mode is available to just the elite plan and trip mode is for the standard plan. the add a trip modal is triggered when the locations icon on the side of the map is clicked.

SOS (manual trigger)
 Clicking the sos icon in the dashboard/active triggers the sos mode. on clicking the button a transparent red modal that covers the whole dashboard is displayed with a 20s timer that counts down and a confirm sos button, cancel sos button underneath. when the confirm button is clicked immediately the sos is sent, when the cancel sos button is clicked the sos is cancelled and the dashboard is displayed. when neither is clicked and the timer gets to 0 the sos is sent. when an sos alert is in progress the following happens. an sms alert is sent to the circle members. if its a trip mode, sos alerts is sent via sms to the circle members tied to that trip.the app 

Follow me 
Follow me feature is available for only the  elite plan users . the feature works by allowing a user to selects members of there circle or family group to follow them for a period of time to a destination. these users are alerted via sms and email immediately the follow me event is set. the user that are selected can view the real time map of the user that set the follow me and the other activities that happen during the lifecycle of the follow me event. the follow me activity is closed by the user that set it and notifications are sent to the selected inner circle or family group members. if during the follow me event an sos is placed, the users selected are alerted alongside the admin dashboard sees the alert.

Fake call
This works by setting in how many minutes the user should receive a call. the user also sets a caller id that the user wants to display when the call comes in. after the set time has elapsed a call is placed to the users phone using the phones set ringtone and the set caller id is shown. The call appears as an actual call and when the user picks the UI for call in session for that phone is shown until the call is ended. every fake call placed and completed is logged in the history page as an activity with correct activity type which is fake call.

 User location when no gps 

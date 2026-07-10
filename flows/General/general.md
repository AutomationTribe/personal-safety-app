Subscription floW
Lets implement subscription. check what has been done against this new flow to decide how to proceed. The new flow logs the user in after successful sign up and navigates to the profile page which shows the subscription plans available. when the user selects a plan the payment process for the available process kicks in. on successful payment user is redirected to dashboard page. When user clicks the logout or any other page before he subscribes, a modal offering 8 days free trial should be displayed.

Dashboard 
 Only users who are subscribed or on a trial can view the dashboard page. after subscription when a user clicks go to dashboard user should be navigated here. when a user logs in successfully user should be navigated to the dashboard. when the user gets to the dashboard, the app should check if gps, audio and sos pin is set in that order. if none is set a modal asking the user to set should be displayed for each not set. the gps and audio modal should take the user to the exact setting in the phone to enable the feature. sos pin setting should display a modal to quickly set sos pin. if all setting has been done the user current location should be shown in the map. User mode value : Always on and Trip mode should be gotten from the users plan and the appropriate one selected. my safety circle section should display not more than 2 circle details if they exist or an empty state with an add a circle member button visible. History section should show trips and alerts and empty state when no history yet. family groups should show when in  elite plan otherwise an upgrade to eLITE plan should be displayed instead. if a user is elite and has not set family group an empty state to add family group should be displayed. if family group exists, not more than 2 family groups with a view all should be shown

 Dashboard - Add a circle member
 On clicking the add a circle member, user should be redirected to the circles page and a add a circle modal should be displayed. The modal should contain Full name, phone number and email(optional) and Add to Circle button. on adding the circle sucessfully a notification should be displayed saying circle member added successfully. errors should be displayed if any is not met

 Dashboard - Add a trip

 when the add a trip button is clicked, a add a trip modal should be displayed. On filling the form with valid data and clicking add trip the trip should be added and toast notification displayed.gps monitoring should start and when user is not at the set destination at the ETA, a ringing tone should be triggered to the phone if auto alert is toggled off but if its toggled on, an sos alert is sent seilently  to the circle members tied to the trip. For scenario where the auto sos is toggled off and the ringing tone has been triggered, a modal will be shown with 2 options Trigger sos or arrived safely. on clicking arrive safely the trip enters, added to history and no sos is sent to circle members. but on clicking sos, alerts are sent to all circle members tied to the trip.


History : this page shows sos alerts and trips. it has a filter and search functionality and also a delete functionality


 User location when no gps 
